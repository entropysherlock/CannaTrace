import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import {
  customers,
  destinations,
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
    weSellTo?: boolean;
    weBuyFrom?: boolean;
  },
): Promise<{ id: string }> {
  const name = required(input.name, "Enter the vendor's business name.");
  const weSellTo = input.weSellTo ?? true;
  const weBuyFrom = input.weBuyFrom ?? false;
  if (!weSellTo && !weBuyFrom) throw new InventoryError("Tick at least one: you sell to them, you buy from them, or both.");
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
        weSellTo,
        weBuyFrom,
      })
      .onConflictDoNothing({ target: [customers.orgId, customers.licenseNumber] })
      .returning({ id: customers.id });
    if (!customer) throw new InventoryError(`A vendor with license ${licenseNumber} already exists.`);
    // Their own licensed location is their first destination.
    await tx.insert(destinations).values({
      orgId: actor.orgId,
      vendorId: customer.id,
      name,
      licenseNumber,
      licenseType,
      licenseExpires,
      address: text(input.address, 300),
      contactName: text(input.contactName),
      phone: text(input.phone, 40),
      email: text(input.email),
    });
    await audit(tx, actor, { entityType: "Vendor", entityId: customer.id, action: "CREATE", after: { name, licenseNumber, licenseExpires, weSellTo, weBuyFrom } });
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
    // The same license at their own location (their first destination) is verified with it.
    await tx
      .update(destinations)
      .set({ licenseExpires, licenseVerifiedAt: new Date(), licenseVerifiedBy: actor.userName })
      .where(and(eq(destinations.vendorId, before.id), eq(destinations.licenseNumber, before.licenseNumber)));
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

/**
 * Why this order can't go to where it is headed, or null. The license that matters is the one at the
 * destination; when that is the vendor's own licensed location, the vendor's record must be good too.
 * Orders from before destinations existed use the vendor's license.
 */
async function shipToProblem(tx: Tx, actor: Actor, order: Order, customer: typeof customers.$inferSelect, today: string): Promise<string | null> {
  if (!order.destinationId) return licenseProblem(customer, today);
  if (!customer.active) return `${customer.name} is marked inactive.`;
  const [destination] = await tx.select().from(destinations).where(and(eq(destinations.id, order.destinationId), eq(destinations.orgId, actor.orgId)));
  if (!destination) return "This order's destination was not found.";
  const problem =
    licenseProblem({ ...destination, name: destination.name === customer.name ? customer.name : `${customer.name} (${destination.name})` }, today) ??
    (destination.licenseNumber === customer.licenseNumber ? licenseProblem(customer, today) : null);
  return problem ? problem.replace("on the customer's page", "on the vendor's page") : null;
}

/** A vendor's destination, or its first active one when none is named. */
async function destinationFor(tx: Tx, actor: Actor, vendorId: string, destinationId?: string | null) {
  const rows = await tx
    .select()
    .from(destinations)
    .where(and(eq(destinations.vendorId, vendorId), eq(destinations.orgId, actor.orgId)))
    .orderBy(destinations.createdAt);
  if (destinationId) {
    const chosen = rows.find((d) => d.id === destinationId);
    if (!chosen) throw new InventoryError("Pick one of this vendor's destinations.");
    if (!chosen.active) throw new InventoryError(`${chosen.name} is marked inactive.`);
    return chosen;
  }
  const first = rows.find((d) => d.active);
  if (!first) throw new InventoryError("This vendor has no active destination to ship to. Add one on the vendor's page.");
  return first;
}

export async function createOrder(actor: Actor, input: { customerId: string; destinationId?: string; notes?: string }): Promise<Order> {
  return db.transaction(async (tx) => {
    const customer = await customerFor(tx, actor, input.customerId);
    if (!customer.active) throw new InventoryError(`${customer.name} is marked inactive.`);
    const destination = await destinationFor(tx, actor, customer.id, input.destinationId || null);
    const number = await nextNumber(tx, actor.facilityId, "SO");
    const [order] = await tx
      .insert(orders)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        number,
        customerId: customer.id,
        destinationId: destination.id,
        notes: text(input.notes, 500),
        userName: actor.userName,
      })
      .returning();
    await audit(tx, actor, { entityType: "Order", entityId: order.id, action: "CREATE", after: { number, vendor: customer.name, destination: destination.name } });
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
    const problem = await shipToProblem(tx, actor, order, await customerFor(tx, actor, order.customerId), todayIn());
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
    const problem = await shipToProblem(tx, actor, order, customer, today);
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

/**
 * A credit memo: lowers what a customer owes on an invoice without money changing hands (a return,
 * a damaged delivery, a price correction). Recorded alongside payments so the balance stays right.
 */
export async function issueCreditMemo(actor: Actor, input: { invoiceId: string; amount: unknown; reason: string }): Promise<{ balance: string }> {
  const amount = parseMoney(input.amount, "Credit amount");
  const reason = required(input.reason, "Say what the credit is for, for example returned product or a damaged delivery.", 200);
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.orgId, actor.orgId), eq(invoices.facilityId, actor.facilityId)))
      .for("update");
    if (!invoice) throw new InventoryError("That invoice was not found at this facility.");
    const paid = await tx.select({ amount: payments.amount }).from(payments).where(eq(payments.invoiceId, invoice.id));
    const { balance } = invoiceBalance(invoice.total, paid.map((p) => p.amount));
    if (balance.lte(0)) throw new InventoryError(`Invoice ${invoice.number} is already settled in full, so there's nothing to credit.`);
    if (amount.gt(balance)) throw new InventoryError(`The credit can be at most the $${balance.toFixed(2)} still owed on invoice ${invoice.number}.`);
    await tx.insert(payments).values({ invoiceId: invoice.id, amount: amount.toFixed(2), method: "CREDIT_MEMO", reference: reason, paidOn: todayIn(), userName: actor.userName });
    await audit(tx, actor, { entityType: "Invoice", entityId: invoice.id, action: "CREDIT_MEMO", after: { amount: amount.toFixed(2) }, reason });
    return { balance: balance.sub(amount).toFixed(2) };
  });
}

// ---------- Destinations and vendor edits ----------

export type DestinationInput = {
  name: string;
  licenseNumber: string;
  licenseType: string;
  licenseExpires: string;
  address?: string;
  contactName?: string;
  phone?: string;
  email?: string;
};

export async function createDestination(actor: Actor, input: DestinationInput & { vendorId: string }): Promise<{ id: string }> {
  const name = required(input.name, "Name the destination, for example its street or store name.");
  const licenseNumber = required(input.licenseNumber, "Enter the destination's license number.", 60).toUpperCase();
  const licenseType = required(input.licenseType, "Enter the license type, for example Retailer.", 60);
  const licenseExpires = parseDate(input.licenseExpires, "License expiry date");
  return db.transaction(async (tx) => {
    const vendor = await customerFor(tx, actor, input.vendorId);
    const [row] = await tx
      .insert(destinations)
      .values({
        orgId: actor.orgId,
        vendorId: vendor.id,
        name,
        licenseNumber,
        licenseType,
        licenseExpires,
        address: text(input.address, 300),
        contactName: text(input.contactName),
        phone: text(input.phone, 40),
        email: text(input.email),
      })
      .onConflictDoNothing({ target: [destinations.vendorId, destinations.licenseNumber] })
      .returning({ id: destinations.id });
    if (!row) throw new InventoryError(`${vendor.name} already has a destination with license ${licenseNumber}.`);
    await audit(tx, actor, { entityType: "Destination", entityId: row.id, action: "CREATE", after: { vendor: vendor.name, name, licenseNumber, licenseExpires } });
    return row;
  });
}

export async function verifyDestinationLicense(actor: Actor, input: { destinationId: string; licenseExpires?: string }): Promise<void> {
  const expires = input.licenseExpires?.trim() ? parseDate(input.licenseExpires, "License expiry date") : null;
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(destinations).where(and(eq(destinations.id, input.destinationId), eq(destinations.orgId, actor.orgId)));
    if (!before) throw new InventoryError("That destination was not found.");
    const licenseExpires = expires ?? before.licenseExpires;
    if (licenseExpires < todayIn()) throw new InventoryError(`This license expired on ${licenseExpires}. Enter the new expiry date from the state's lookup to verify it.`);
    await tx.update(destinations).set({ licenseExpires, licenseVerifiedAt: new Date(), licenseVerifiedBy: actor.userName }).where(eq(destinations.id, before.id));
    // The vendor's own record carries the same license when this is their main location.
    await tx
      .update(customers)
      .set({ licenseExpires, licenseVerifiedAt: new Date(), licenseVerifiedBy: actor.userName })
      .where(and(eq(customers.id, before.vendorId), eq(customers.licenseNumber, before.licenseNumber)));
    await audit(tx, actor, {
      entityType: "Destination",
      entityId: before.id,
      action: "VERIFY_LICENSE",
      before: { licenseExpires: before.licenseExpires },
      after: { licenseExpires, verifiedBy: actor.userName },
    });
  });
}

/** Fields of a vendor that can be changed, one at a time or in bulk. */
export type VendorChanges = Partial<{
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number;
  priceListId: string | null;
  active: boolean;
  weSellTo: boolean;
  weBuyFrom: boolean;
}>;

/** Fields of a destination that can be changed, one at a time or in bulk. */
export type DestinationChanges = Partial<{
  name: string;
  licenseType: string;
  licenseExpires: string;
  address: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}>;

/** Check and tidy vendor changes. Throws a message a person can act on. */
export async function cleanVendorChanges(tx: Tx | typeof db, orgId: string, raw: Record<string, unknown>): Promise<VendorChanges> {
  const out: VendorChanges = {};
  const opt = (v: unknown, max = 120) => (v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
  if ("name" in raw) out.name = required(String(raw.name ?? ""), "A vendor needs a name.");
  if ("contactName" in raw) out.contactName = opt(raw.contactName);
  if ("email" in raw) out.email = opt(raw.email);
  if ("phone" in raw) out.phone = opt(raw.phone, 40);
  if ("address" in raw) out.address = opt(raw.address, 300);
  if ("paymentTermsDays" in raw) {
    const n = Number(raw.paymentTermsDays);
    if (!Number.isInteger(n) || n < 0 || n > 120) throw new InventoryError("Payment terms must be a whole number of days from 0 to 120.");
    out.paymentTermsDays = n;
  }
  if ("priceListId" in raw) {
    const id = opt(raw.priceListId);
    if (id) {
      const [list] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.orgId, orgId)));
      if (!list) throw new InventoryError("Pick a price list from your own lists.");
    }
    out.priceListId = id;
  }
  for (const key of ["active", "weSellTo", "weBuyFrom"] as const) if (key in raw) out[key] = Boolean(raw[key]);
  return out;
}

export function cleanDestinationChanges(raw: Record<string, unknown>): DestinationChanges {
  const out: DestinationChanges = {};
  const opt = (v: unknown, max = 120) => (v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
  if ("name" in raw) out.name = required(String(raw.name ?? ""), "A destination needs a name.");
  if ("licenseType" in raw) out.licenseType = required(String(raw.licenseType ?? ""), "Enter the license type.", 60);
  if ("licenseExpires" in raw) out.licenseExpires = parseDate(String(raw.licenseExpires ?? ""), "License expiry date");
  if ("address" in raw) out.address = opt(raw.address, 300);
  if ("contactName" in raw) out.contactName = opt(raw.contactName);
  if ("phone" in raw) out.phone = opt(raw.phone, 40);
  if ("email" in raw) out.email = opt(raw.email);
  if ("active" in raw) out.active = Boolean(raw.active);
  return out;
}

/** Apply the same changes to several vendors at once. All or nothing; each vendor gets its own audit entry. */
export async function updateVendors(actor: Actor, vendorIds: string[], raw: Record<string, unknown>): Promise<number> {
  if (vendorIds.length === 0) throw new InventoryError("No vendors were chosen.");
  return db.transaction(async (tx) => {
    const changes = await cleanVendorChanges(tx, actor.orgId, raw);
    if (Object.keys(changes).length === 0) throw new InventoryError("Nothing to change.");
    if (changes.weSellTo === false && changes.weBuyFrom === false) throw new InventoryError("A vendor must be one you sell to, buy from, or both.");
    let n = 0;
    for (const id of vendorIds) {
      const [before] = await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, actor.orgId))).for("update");
      if (!before) throw new InventoryError("One of the vendors no longer exists. Nothing was changed.");
      const next = { ...changes };
      if ((next.weSellTo ?? before.weSellTo) === false && (next.weBuyFrom ?? before.weBuyFrom) === false)
        throw new InventoryError(`${before.name} would be neither a vendor you sell to nor one you buy from. Nothing was changed.`);
      await tx.update(customers).set(next).where(eq(customers.id, id));
      const was = Object.fromEntries(Object.keys(next).map((k) => [k, before[k as keyof typeof before]]));
      await audit(tx, actor, { entityType: "Vendor", entityId: id, action: "UPDATE", before: was, after: next });
      n++;
    }
    return n;
  });
}

/** Apply the same changes to several destinations at once. All or nothing, with an audit entry for each. */
export async function updateDestinations(actor: Actor, destinationIds: string[], raw: Record<string, unknown>): Promise<number> {
  if (destinationIds.length === 0) throw new InventoryError("No destinations were chosen.");
  const changes = cleanDestinationChanges(raw);
  if (Object.keys(changes).length === 0) throw new InventoryError("Nothing to change.");
  return db.transaction(async (tx) => {
    let n = 0;
    for (const id of destinationIds) {
      const [before] = await tx.select().from(destinations).where(and(eq(destinations.id, id), eq(destinations.orgId, actor.orgId))).for("update");
      if (!before) throw new InventoryError("One of the destinations no longer exists. Nothing was changed.");
      // A new expiry date means the license must be checked again before the next shipment.
      const reverify = changes.licenseExpires && changes.licenseExpires !== before.licenseExpires ? { licenseVerifiedAt: null, licenseVerifiedBy: null } : {};
      await tx.update(destinations).set({ ...changes, ...reverify }).where(eq(destinations.id, id));
      const was = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof typeof before]]));
      await audit(tx, actor, { entityType: "Destination", entityId: id, action: "UPDATE", before: was, after: changes });
      n++;
    }
    return n;
  });
}
