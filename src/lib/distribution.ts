import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import {
  customers,
  drivers,
  invoices,
  items,
  orderAllocations,
  orderLines,
  orders,
  packages,
  payments,
  priceListItems,
  priceLists,
  vehicles,
  type Order,
  type Package,
} from "@/db/schema";
import { db, type Tx } from "./db";
import {
  PAYMENT_METHODS,
  addDays,
  invoiceBalance,
  licenseProblem,
  lineTotal,
  parseDate,
  parseMoney,
  parsePrice,
  todayIn,
} from "./distribution-math";
import {
  InventoryError,
  audit,
  lockPackage,
  setAllocatedInTx,
  shipPackageInTx,
  splitPackageInTx,
  type Actor,
} from "./inventory";
import { normalizeTag, parsePositiveQty } from "./inventory-math";
import { nextNumber } from "./numbering";

const store = (value: Decimal) => value.toFixed(4);

function text(value: string | null | undefined, max = 200): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
function required(value: string | null | undefined, message: string, max = 200): string {
  const trimmed = text(value, max);
  if (!trimmed) throw new InventoryError(message);
  return trimmed;
}

// ---------- Customers, price lists, fleet ----------

export async function createCustomer(
  actor: Actor,
  input: {
    name: string;
    licenseNumber: string;
    licenseType: string;
    licenseExpires: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    paymentTermsDays?: unknown;
  },
): Promise<{ id: string }> {
  const name = required(input.name, "Enter the customer's business name.");
  const licenseNumber = required(input.licenseNumber, "Enter the customer's license number.", 60).toUpperCase();
  const licenseType = required(input.licenseType, "Enter the license type, for example Retailer.", 60);
  const licenseExpires = parseDate(input.licenseExpires, "License expiry date");
  const termsText = String(input.paymentTermsDays ?? "").trim();
  const terms = termsText === "" ? 0 : Number(termsText);
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) throw new InventoryError("Payment terms must be a whole number of days from 0 to 120.");
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        orgId: actor.orgId,
        name,
        licenseNumber,
        licenseType,
        licenseExpires,
        contactName: text(input.contactName),
        email: text(input.email),
        phone: text(input.phone, 40),
        address: text(input.address, 300),
        paymentTermsDays: terms,
      })
      .onConflictDoNothing({ target: [customers.orgId, customers.licenseNumber] })
      .returning({ id: customers.id });
    if (!customer) throw new InventoryError(`A customer with license ${licenseNumber} already exists.`);
    await audit(tx, actor, { entityType: "Customer", entityId: customer.id, action: "CREATE", after: { name, licenseNumber, licenseExpires } });
    return customer;
  });
}

/** Record that someone checked the license against the state's lookup. Optionally update the expiry date. */
export async function verifyCustomerLicense(
  actor: Actor,
  input: { customerId: string; licenseExpires?: string },
): Promise<void> {
  const expires = input.licenseExpires?.trim() ? parseDate(input.licenseExpires, "License expiry date") : null;
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.orgId, actor.orgId)));
    if (!before) throw new InventoryError("That customer was not found.");
    const licenseExpires = expires ?? before.licenseExpires;
    if (licenseExpires < todayIn()) {
      throw new InventoryError(`This license expired on ${licenseExpires}. Enter the new expiry date from the state's lookup to verify it.`);
    }
    await tx
      .update(customers)
      .set({ licenseExpires, licenseVerifiedAt: new Date(), licenseVerifiedBy: actor.userName })
      .where(eq(customers.id, before.id));
    await audit(tx, actor, {
      entityType: "Customer",
      entityId: before.id,
      action: "VERIFY_LICENSE",
      before: { licenseExpires: before.licenseExpires },
      after: { licenseExpires, verifiedBy: actor.userName },
    });
  });
}

export async function setCustomerPriceList(actor: Actor, input: { customerId: string; priceListId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    if (input.priceListId) {
      const [list] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, input.priceListId), eq(priceLists.orgId, actor.orgId)));
      if (!list) throw new InventoryError("Pick a price list from the list.");
    }
    const [updated] = await tx
      .update(customers)
      .set({ priceListId: input.priceListId || null })
      .where(and(eq(customers.id, input.customerId), eq(customers.orgId, actor.orgId)))
      .returning({ id: customers.id });
    if (!updated) throw new InventoryError("That customer was not found.");
    await audit(tx, actor, { entityType: "Customer", entityId: updated.id, action: "SET_PRICE_LIST", after: { priceListId: input.priceListId || null } });
  });
}

export async function createPriceList(actor: Actor, input: { name: string }): Promise<{ id: string }> {
  const name = required(input.name, "Give the price list a name.", 80);
  return db.transaction(async (tx) => {
    const existing = await tx.$count(priceLists, eq(priceLists.orgId, actor.orgId));
    const [list] = await tx
      .insert(priceLists)
      .values({ orgId: actor.orgId, name, isDefault: existing === 0 })
      .onConflictDoNothing({ target: [priceLists.orgId, priceLists.name] })
      .returning({ id: priceLists.id });
    if (!list) throw new InventoryError(`There is already a price list called ${name}.`);
    await audit(tx, actor, { entityType: "PriceList", entityId: list.id, action: "CREATE", after: { name } });
    return list;
  });
}

export async function setPrice(actor: Actor, input: { priceListId: string; itemId: string; price: unknown }): Promise<void> {
  const price = parsePrice(input.price);
  await db.transaction(async (tx) => {
    const [list] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, input.priceListId), eq(priceLists.orgId, actor.orgId)));
    const [item] = await tx.select({ id: items.id }).from(items).where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId)));
    if (!list || !item) throw new InventoryError("Pick a price list and an item from the lists.");
    await tx
      .insert(priceListItems)
      .values({ priceListId: list.id, itemId: item.id, price: store(price) })
      .onConflictDoUpdate({ target: [priceListItems.priceListId, priceListItems.itemId], set: { price: store(price) } });
    await audit(tx, actor, { entityType: "PriceList", entityId: list.id, action: "SET_PRICE", after: { itemId: item.id, price: price.toString() } });
  });
}

export async function createDriver(actor: Actor, input: { name: string; licenseNumber: string; phone?: string }): Promise<void> {
  const name = required(input.name, "Enter the driver's name.", 100);
  const licenseNumber = required(input.licenseNumber, "Enter the driver's license number. It is printed on the manifest.", 40);
  await db.transaction(async (tx) => {
    const [driver] = await tx.insert(drivers).values({ orgId: actor.orgId, name, licenseNumber, phone: text(input.phone, 40) }).returning({ id: drivers.id });
    await audit(tx, actor, { entityType: "Driver", entityId: driver.id, action: "CREATE", after: { name } });
  });
}

export async function createVehicle(actor: Actor, input: { make: string; model: string; plate: string }): Promise<void> {
  const make = required(input.make, "Enter the vehicle make.", 60);
  const model = required(input.model, "Enter the vehicle model.", 60);
  const plate = required(input.plate, "Enter the license plate.", 20).toUpperCase();
  await db.transaction(async (tx) => {
    const [vehicle] = await tx
      .insert(vehicles)
      .values({ orgId: actor.orgId, make, model, plate })
      .onConflictDoNothing({ target: [vehicles.orgId, vehicles.plate] })
      .returning({ id: vehicles.id });
    if (!vehicle) throw new InventoryError(`A vehicle with plate ${plate} already exists.`);
    await audit(tx, actor, { entityType: "Vehicle", entityId: vehicle.id, action: "CREATE", after: { make, model, plate } });
  });
}

// ---------- Orders ----------

async function lockOrder(tx: Tx, actor: Actor, orderId: string, allowed: Order["status"][], verb: string): Promise<Order> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, actor.orgId), eq(orders.facilityId, actor.facilityId)))
    .for("update");
  if (!order) throw new InventoryError("That order was not found at this facility.");
  if (!allowed.includes(order.status)) {
    throw new InventoryError(`Order ${order.number} is ${order.status.toLowerCase()}, so it cannot be ${verb}.`);
  }
  return order;
}

async function customerFor(tx: Tx, actor: Actor, customerId: string) {
  const [customer] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.orgId, actor.orgId)));
  if (!customer) throw new InventoryError("Pick a customer from the list.");
  return customer;
}

export async function createOrder(actor: Actor, input: { customerId: string; notes?: string }): Promise<Order> {
  return db.transaction(async (tx) => {
    const customer = await customerFor(tx, actor, input.customerId);
    if (!customer.active) throw new InventoryError(`${customer.name} is marked inactive.`);
    const number = await nextNumber(tx, actor.facilityId, "SO");
    const [order] = await tx
      .insert(orders)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, number, customerId: customer.id, notes: text(input.notes, 500), userName: actor.userName })
      .returning();
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "CREATE", after: { number, customer: customer.name } });
    return order;
  });
}

/** The price a customer pays for an item: their own list first, then the default list. Null when neither has it. */
export async function priceFor(tx: Tx | typeof db, orgId: string, customerPriceListId: string | null, itemId: string): Promise<string | null> {
  const rows = await tx
    .select({ price: priceListItems.price, isDefault: priceLists.isDefault, listId: priceLists.id })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
    .where(and(eq(priceLists.orgId, orgId), eq(priceListItems.itemId, itemId)));
  const own = rows.find((r) => r.listId === customerPriceListId);
  return (own ?? rows.find((r) => r.isDefault))?.price ?? null;
}

export async function addOrderLine(
  actor: Actor,
  input: { orderId: string; itemId: string; quantity: unknown; unitPrice?: unknown },
): Promise<void> {
  const quantity = parsePositiveQty(input.quantity);
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["DRAFT"], "changed. Only draft orders can be edited");
    const [item] = await tx.select().from(items).where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId), eq(items.active, true)));
    if (!item) throw new InventoryError("Pick an item from the list.");
    const typed = String(input.unitPrice ?? "").trim();
    let price: Decimal;
    if (typed) {
      price = parsePrice(typed);
    } else {
      const customer = await customerFor(tx, actor, order.customerId);
      const listed = await priceFor(tx, actor.orgId, customer.priceListId, item.id);
      if (listed === null) throw new InventoryError(`${item.name} is not on this customer's price list. Type a price for it.`);
      price = new Decimal(listed);
    }
    const [line] = await tx
      .insert(orderLines)
      .values({ orderId: order.id, itemId: item.id, quantity: store(quantity), unitPrice: store(price) })
      .onConflictDoNothing({ target: [orderLines.orderId, orderLines.itemId] })
      .returning({ id: orderLines.id });
    if (!line) throw new InventoryError(`${item.name} is already on this order. Remove that line first to change it.`);
    await audit(tx, actor, {
      entityType: "Order",
      entityId: order.id,
      action: "ADD_LINE",
      after: { item: item.name, quantity: quantity.toString(), unitPrice: price.toString() },
    });
  });
}

export async function removeOrderLine(actor: Actor, input: { lineId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(orderLines).where(eq(orderLines.id, input.lineId));
    if (!line) throw new InventoryError("That line was already removed.");
    const order = await lockOrder(tx, actor, line.orderId, ["DRAFT"], "changed. Only draft orders can be edited");
    await tx.delete(orderLines).where(eq(orderLines.id, line.id));
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "REMOVE_LINE", before: { itemId: line.itemId, quantity: line.quantity } });
  });
}

export async function confirmOrder(actor: Actor, input: { orderId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["DRAFT"], "confirmed again");
    if ((await tx.$count(orderLines, eq(orderLines.orderId, order.id))) === 0) throw new InventoryError("Add at least one line before confirming.");
    const problem = licenseProblem(await customerFor(tx, actor, order.customerId), todayIn());
    if (problem) throw new InventoryError(problem);
    await tx.update(orders).set({ status: "CONFIRMED", confirmedAt: new Date() }).where(eq(orders.id, order.id));
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "CONFIRM" });
  });
}

/**
 * Pick product for an order line. Taking a whole package sets that package aside.
 * Taking part of one splits the picked amount into a new package, which needs its own tag.
 */
export async function allocateToOrder(
  actor: Actor,
  input: { orderId: string; lineId: string; tag: string; quantity?: unknown; newTag?: string },
): Promise<Package> {
  const tag = normalizeTag(input.tag);
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["CONFIRMED"], "picked. Confirm it first, or reopen it if it is packed");
    const [line] = await tx.select().from(orderLines).where(and(eq(orderLines.id, input.lineId), eq(orderLines.orderId, order.id)));
    if (!line) throw new InventoryError("That order line was not found.");
    const [found] = await tx
      .select({ id: packages.id })
      .from(packages)
      .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.tag, tag)));
    if (!found) throw new InventoryError(`No package with tag ${tag} at this facility.`);
    const source = await lockPackage(tx, actor, found.id);
    if (source.itemId !== line.itemId) throw new InventoryError(`Package ${tag} holds a different item than this order line.`);
    if (source.status !== "ACTIVE") {
      throw new InventoryError(`Package ${tag} is ${source.status.replace("_", " ").toLowerCase()} and cannot be put on an order.`);
    }

    const quantityText = String(input.quantity ?? "").trim();
    const quantity = quantityText === "" ? new Decimal(source.quantity) : parsePositiveQty(quantityText);
    if (quantity.gt(source.quantity)) {
      throw new InventoryError(`Package ${tag} only holds ${new Decimal(source.quantity).toString()}.`);
    }
    const already = await tx
      .select({ total: sql<string>`coalesce(sum(${orderAllocations.quantity}), 0)` })
      .from(orderAllocations)
      .where(eq(orderAllocations.orderLineId, line.id));
    const open = new Decimal(line.quantity).sub(already[0].total);
    if (quantity.gt(open)) {
      throw new InventoryError(
        open.lte(0)
          ? "This line is already fully picked."
          : `This line only needs ${open.toString()} more. Enter a quantity to pick part of package ${tag}.`,
      );
    }

    const note = `Picked for order ${order.number}`;
    let picked = source;
    if (quantity.lt(source.quantity)) {
      if (!input.newTag?.trim()) {
        throw new InventoryError(`Picking part of package ${tag} makes a new package. Scan a new tag for the ${quantity.toString()} being picked.`);
      }
      const split = await splitPackageInTx(tx, actor, { packageId: source.id, parts: [{ tag: input.newTag, quantity }], note });
      picked = split.children[0];
    }
    const allocated = await setAllocatedInTx(tx, actor, picked, true, note);
    await tx.insert(orderAllocations).values({
      orderId: order.id,
      orderLineId: line.id,
      packageId: allocated.id,
      quantity: store(quantity),
      userName: actor.userName,
    });
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "PICK", after: { tag: allocated.tag, quantity: quantity.toString() } });
    return allocated;
  });
}

async function releaseAllocation(tx: Tx, actor: Actor, order: Order, allocation: { id: string; packageId: string }) {
  const pkg = await lockPackage(tx, actor, allocation.packageId);
  await setAllocatedInTx(tx, actor, pkg, false, `Released from order ${order.number}`);
  await tx.delete(orderAllocations).where(eq(orderAllocations.id, allocation.id));
  return pkg;
}

export async function unallocateFromOrder(actor: Actor, input: { allocationId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [allocation] = await tx.select().from(orderAllocations).where(eq(orderAllocations.id, input.allocationId));
    if (!allocation) throw new InventoryError("That package was already taken off the order.");
    const order = await lockOrder(tx, actor, allocation.orderId, ["CONFIRMED"], "changed. Reopen it first if it is packed");
    const pkg = await releaseAllocation(tx, actor, order, allocation);
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "UNPICK", after: { tag: pkg.tag } });
  });
}

export async function packOrder(actor: Actor, input: { orderId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["CONFIRMED"], "packed");
    if ((await tx.$count(orderAllocations, eq(orderAllocations.orderId, order.id))) === 0) {
      throw new InventoryError("Pick at least one package before marking the order packed.");
    }
    await tx.update(orders).set({ status: "PACKED", packedAt: new Date() }).where(eq(orders.id, order.id));
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "PACK" });
  });
}

export async function reopenOrder(actor: Actor, input: { orderId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["PACKED"], "reopened");
    await tx.update(orders).set({ status: "CONFIRMED", packedAt: null }).where(eq(orders.id, order.id));
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "REOPEN" });
  });
}

/** Send a packed order out: packages leave inventory, a manifest number is issued, and the invoice is created. */
export async function shipOrder(
  actor: Actor,
  input: { orderId: string; driverId: string; vehicleId: string; departAt: string; routeNotes?: string },
): Promise<{ manifestNumber: string; invoiceNumber: string }> {
  const departAt = required(input.departAt, "Enter the departure date and time.", 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(departAt)) throw new InventoryError("Enter the departure date and time.");
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["PACKED"], "shipped. Mark it packed first");
    const customer = await customerFor(tx, actor, order.customerId);
    const today = todayIn();
    const problem = licenseProblem(customer, today);
    if (problem) throw new InventoryError(problem);
    const [driver] = await tx.select().from(drivers).where(and(eq(drivers.id, input.driverId), eq(drivers.orgId, actor.orgId), eq(drivers.active, true)));
    const [vehicle] = await tx.select().from(vehicles).where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.orgId, actor.orgId), eq(vehicles.active, true)));
    if (!driver) throw new InventoryError("Choose a driver.");
    if (!vehicle) throw new InventoryError("Choose a vehicle.");

    const allocations = await tx
      .select({ packageId: orderAllocations.packageId })
      .from(orderAllocations)
      .where(eq(orderAllocations.orderId, order.id))
      .orderBy(orderAllocations.packageId);
    if (allocations.length === 0) throw new InventoryError("This order has no packages on it.");

    const manifestNumber = await nextNumber(tx, actor.facilityId, "MAN");
    const invoiceNumber = await nextNumber(tx, actor.facilityId, "INV");
    for (const allocation of allocations) {
      await shipPackageInTx(tx, actor, allocation.packageId, `Shipped to ${customer.name} on manifest ${manifestNumber}`);
    }
    // Invoice what actually shipped, line by line, so short shipments bill correctly.
    const lineTotals = await tx
      .select({ lineId: orderAllocations.orderLineId, unitPrice: orderLines.unitPrice, shipped: sql<string>`sum(${orderAllocations.quantity})` })
      .from(orderAllocations)
      .innerJoin(orderLines, eq(orderLines.id, orderAllocations.orderLineId))
      .where(eq(orderAllocations.orderId, order.id))
      .groupBy(orderAllocations.orderLineId, orderLines.unitPrice);
    const total = lineTotals.reduce((sum, l) => sum.add(lineTotal(l.shipped, l.unitPrice)), new Decimal(0));

    await tx
      .update(orders)
      .set({
        status: "SHIPPED",
        shippedAt: new Date(),
        manifestNumber,
        driverId: driver.id,
        vehicleId: vehicle.id,
        departAt,
        routeNotes: text(input.routeNotes, 500),
      })
      .where(eq(orders.id, order.id));
    await tx.insert(invoices).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      orderId: order.id,
      customerId: customer.id,
      number: invoiceNumber,
      total: total.toFixed(2),
      dueDate: addDays(today, customer.paymentTermsDays),
    });
    await audit(tx, actor, {
      entityType: "Order",
      entityId: order.id,
      action: "SHIP",
      after: { manifestNumber, invoiceNumber, driver: driver.name, vehicle: vehicle.plate, packages: allocations.length, total: total.toFixed(2) },
    });
    return { manifestNumber, invoiceNumber };
  });
}

export async function deliverOrder(actor: Actor, input: { orderId: string; receivedBy: string }): Promise<void> {
  const receivedBy = required(input.receivedBy, "Enter the name of the person who received the delivery.", 100);
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["SHIPPED"], "marked delivered");
    await tx.update(orders).set({ status: "DELIVERED", deliveredAt: new Date(), receivedBy }).where(eq(orders.id, order.id));
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "DELIVER", after: { receivedBy } });
  });
}

/** Cancel an order that has not shipped. Every picked package goes back to active stock. */
export async function cancelOrder(actor: Actor, input: { orderId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const order = await lockOrder(tx, actor, input.orderId, ["DRAFT", "CONFIRMED", "PACKED"], "cancelled");
    const allocations = await tx
      .select({ id: orderAllocations.id, packageId: orderAllocations.packageId })
      .from(orderAllocations)
      .where(eq(orderAllocations.orderId, order.id))
      .orderBy(orderAllocations.packageId);
    for (const allocation of allocations) await releaseAllocation(tx, actor, order, allocation);
    await tx.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, order.id));
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "CANCEL", after: { releasedPackages: allocations.length } });
  });
}

export async function recordPayment(
  actor: Actor,
  input: { invoiceId: string; amount: unknown; method: string; paidOn: string; reference?: string },
): Promise<{ balance: string }> {
  const amount = parseMoney(input.amount, "Payment amount");
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new InventoryError("Choose how it was paid.");
  const paidOn = parseDate(input.paidOn, "Payment date");
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.orgId, actor.orgId), eq(invoices.facilityId, actor.facilityId)))
      .for("update");
    if (!invoice) throw new InventoryError("That invoice was not found at this facility.");
    const paid = await tx.select({ amount: payments.amount }).from(payments).where(eq(payments.invoiceId, invoice.id));
    const { balance } = invoiceBalance(invoice.total, paid.map((p) => p.amount));
    if (balance.lte(0)) throw new InventoryError(`Invoice ${invoice.number} is already paid in full.`);
    if (amount.gt(balance)) throw new InventoryError(`Only $${balance.toFixed(2)} is still owed on invoice ${invoice.number}.`);
    await tx.insert(payments).values({
      invoiceId: invoice.id,
      amount: amount.toFixed(2),
      method: input.method,
      reference: text(input.reference, 100),
      paidOn,
      userName: actor.userName,
    });
    await audit(tx, actor, {
      entityType: "Invoice",
      entityId: invoice.id,
      action: "PAYMENT",
      after: { amount: amount.toFixed(2), method: input.method, paidOn },
    });
    return { balance: balance.sub(amount).toFixed(2) };
  });
}
