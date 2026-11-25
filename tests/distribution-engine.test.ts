import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customers, drivers, facilities, invoices, itemCategories, items, locations, orders, organizations, packages, payments, users, vehicles } from "@/db/schema";
import { db, pool } from "@/lib/db";
import {
  addOrderLine,
  allocateToOrder,
  cancelOrder,
  confirmOrder,
  createCustomer,
  createDriver,
  createOrder,
  createPriceList,
  createVehicle,
  deliverOrder,
  packOrder,
  recordPayment,
  removeOrderLine,
  reopenOrder,
  setCustomerPriceList,
  setPrice,
  shipOrder,
  unallocateFromOrder,
  verifyCustomerLicense,
} from "@/lib/distribution";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, adjustPackage, destroyPackage, receivePackage, splitPackage, type Actor } from "@/lib/inventory";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `D${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

let actor: Actor;
let other: Actor;
let jars: string;
let prerolls: string;
let shelf: string;
let customerId: string;
let driverId: string;
let vehicleId: string;

const pkg = async (id: string) => {
  const [row] = await db.select().from(packages).where(eq(packages.id, id));
  return { quantity: new Decimal(row.quantity).toString(), status: row.status };
};
const order = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0];
// Product goes to a retailer only with a passing lab result in a state that tests before retail sale (APEX-26).
const receive = async (itemId: string, quantity: string) => {
  const pkg = await receivePackage(actor, { tag: tag(), itemId, quantity, locationId: shelf, lotNumber: "LOT-D" });
  await addLabResult(actor, { packageId: pkg.id, labName: "Lab", status: "PASS", thcPercent: "20" });
  return pkg;
};
const lineId = async (orderId: string, itemId: string) =>
  (await db.execute<{ id: string }>(sql`select id from order_lines where order_id = ${orderId} and item_id = ${itemId}`)).rows[0].id;

describe.skipIf(!hasDb)("distribution engine (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Dist Org ${run}` }).returning();
    const [facility, second] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "DC", licenseNumber: `${run}-A`, licenseType: "DISTRIBUTION", state: "NM" },
        { orgId: org.id, name: "Other", licenseNumber: `${run}-B`, licenseType: "DISTRIBUTION", state: "NM" },
      ])
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Seller", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "SALES" })
      .returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Shelf", type: "RACK" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db
      .insert(items)
      .values([
        { orgId: org.id, name: "Jar", sku: "JAR", categoryId: category.id, unit: "EACH" },
        { orgId: org.id, name: "Pre-roll", sku: "PR", categoryId: category.id, unit: "EACH" },
      ])
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    other = { ...actor, facilityId: second.id };
    shelf = location.id;
    [jars, prerolls] = made.map((i) => i.id);

    customerId = (
      await createCustomer(actor, { name: "Mesa Retail", licenseNumber: `${run}-cust`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 200), paymentTermsDays: "15" })
    ).id;
    const standard = await createPriceList(actor, { name: "Standard" });
    const vip = await createPriceList(actor, { name: "VIP" });
    await setPrice(actor, { priceListId: standard.id, itemId: jars, price: "12.50" });
    await setPrice(actor, { priceListId: standard.id, itemId: prerolls, price: "2.75" });
    await setPrice(actor, { priceListId: vip.id, itemId: jars, price: "11" });
    await setCustomerPriceList(actor, { customerId, priceListId: vip.id });
    await createDriver(actor, { name: "Dana Driver", licenseNumber: "D-123" });
    await createVehicle(actor, { make: "Ford", model: "Transit", plate: `${run}`.slice(0, 8) });
    driverId = (await db.select().from(drivers).where(eq(drivers.orgId, org.id)))[0].id;
    vehicleId = (await db.select().from(vehicles).where(eq(vehicles.orgId, org.id)))[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("refuses duplicate licenses and bad dates", async () => {
    const base = { name: "Dup", licenseType: "Retailer", licenseExpires: "2030-01-01" };
    await expect(createCustomer(actor, { ...base, licenseNumber: `${run}-CUST` })).rejects.toThrow(/already exists/);
    await expect(createCustomer(actor, { ...base, licenseNumber: `${run}-X`, licenseExpires: "2030-02-30" })).rejects.toThrow(/real date/);
  });

  it("will not confirm an order until the license is verified", async () => {
    const o = await createOrder(actor, { customerId });
    await expect(confirmOrder(actor, { orderId: o.id })).rejects.toThrow(/at least one line/);
    await addOrderLine(actor, { orderId: o.id, itemId: jars, quantity: "10" });
    await expect(confirmOrder(actor, { orderId: o.id })).rejects.toThrow(/not been verified/);
    await verifyCustomerLicense(actor, { customerId });
    await confirmOrder(actor, { orderId: o.id });
    await expect(addOrderLine(actor, { orderId: o.id, itemId: prerolls, quantity: "5" })).rejects.toThrow(/Only draft orders/);
    await cancelOrder(actor, { orderId: o.id });
  });

  it("prices from the customer's list, then the default list", async () => {
    const o = await createOrder(actor, { customerId });
    await addOrderLine(actor, { orderId: o.id, itemId: jars, quantity: "10" });
    await addOrderLine(actor, { orderId: o.id, itemId: prerolls, quantity: "10" });
    const rows = (await db.execute<{ item_id: string; unit_price: string }>(sql`select item_id, unit_price from order_lines where order_id = ${o.id}`)).rows;
    expect(new Decimal(rows.find((r) => r.item_id === jars)!.unit_price).toString()).toBe("11");
    expect(new Decimal(rows.find((r) => r.item_id === prerolls)!.unit_price).toString()).toBe("2.75");
    await expect(addOrderLine(actor, { orderId: o.id, itemId: jars, quantity: "1" })).rejects.toThrow(/already on this order/);
    await removeOrderLine(actor, { lineId: await lineId(o.id, jars) });
    await addOrderLine(actor, { orderId: o.id, itemId: jars, quantity: "1", unitPrice: "9.99" });
    await cancelOrder(actor, { orderId: o.id });
  });

  it("runs an order from draft to paid", async () => {
    const whole = await receive(jars, "48");
    const big = await receive(jars, "200");
    const rolls = await receive(prerolls, "500");
    const o = await createOrder(actor, { customerId });
    expect(o.number).toMatch(/^SO-\d{5}$/);
    await addOrderLine(actor, { orderId: o.id, itemId: jars, quantity: "96" });
    await addOrderLine(actor, { orderId: o.id, itemId: prerolls, quantity: "200" });
    const jarLine = await lineId(o.id, jars);
    const rollLine = await lineId(o.id, prerolls);
    await expect(allocateToOrder(actor, { orderId: o.id, lineId: jarLine, tag: whole.tag })).rejects.toThrow(/Confirm it first/);
    await confirmOrder(actor, { orderId: o.id });

    // Whole package, then part of another (the picked part gets a new tag, generated when none is given), then guards
    await allocateToOrder(actor, { orderId: o.id, lineId: jarLine, tag: whole.tag });
    expect((await pkg(whole.id)).status).toBe("ALLOCATED");
    await expect(allocateToOrder(actor, { orderId: o.id, lineId: jarLine, tag: big.tag })).rejects.toThrow(/only needs 48 more/);
    await expect(allocateToOrder(actor, { orderId: o.id, lineId: jarLine, tag: rolls.tag, quantity: "10", newTag: tag() })).rejects.toThrow(/different item/);
    const picked = await allocateToOrder(actor, { orderId: o.id, lineId: jarLine, tag: big.tag, quantity: "48" });
    expect(picked.tag).toMatch(/^PKG-\d{6}$/);
    expect((await pkg(big.id)).quantity).toBe("152");
    expect(await pkg(picked.id)).toEqual({ quantity: "48", status: "ALLOCATED" });
    await expect(allocateToOrder(actor, { orderId: o.id, lineId: jarLine, tag: big.tag, quantity: "1", newTag: tag() })).rejects.toThrow(/already fully picked/);

    // Allocated stock is protected from everything else
    await expect(adjustPackage(actor, { packageId: whole.id, newQuantity: "40", reasonCode: "DAMAGE" })).rejects.toThrow(/set aside for a wholesale order/);
    await expect(destroyPackage(actor, { packageId: whole.id, reason: "x" })).rejects.toThrow(/set aside/);
    await expect(splitPackage(actor, { packageId: whole.id, parts: [{ tag: tag(), quantity: "1" }] })).rejects.toThrow(/allocated/);
    const second = await createOrder(actor, { customerId });
    await addOrderLine(actor, { orderId: second.id, itemId: jars, quantity: "48" });
    await confirmOrder(actor, { orderId: second.id });
    await expect(allocateToOrder(actor, { orderId: second.id, lineId: await lineId(second.id, jars), tag: whole.tag })).rejects.toThrow(/allocated/);
    await cancelOrder(actor, { orderId: second.id });

    // Short-pick the pre-rolls (150 of 200), unpick and repick
    const short = await allocateToOrder(actor, { orderId: o.id, lineId: rollLine, tag: rolls.tag, quantity: "150", newTag: tag() });
    const allocationId = (await db.execute<{ id: string }>(sql`select id from order_allocations where package_id = ${short.id}`)).rows[0].id;
    await unallocateFromOrder(actor, { allocationId });
    expect((await pkg(short.id)).status).toBe("ACTIVE");
    await allocateToOrder(actor, { orderId: o.id, lineId: rollLine, tag: short.tag });

    await expect(shipOrder(actor, { orderId: o.id, driverId, vehicleId, departAt: "2026-11-17T09:00" })).rejects.toThrow(/Mark it packed first/);
    await packOrder(actor, { orderId: o.id });
    await expect(unallocateFromOrder(actor, { allocationId: allocationId })).rejects.toThrow();
    await reopenOrder(actor, { orderId: o.id });
    await packOrder(actor, { orderId: o.id });
    await expect(shipOrder(actor, { orderId: o.id, driverId: "nope", vehicleId, departAt: "2026-11-17T09:00" })).rejects.toThrow(/Choose a driver/);
    await expect(shipOrder(other, { orderId: o.id, driverId, vehicleId, departAt: "2026-11-17T09:00" })).rejects.toThrow(/not found/);

    const shipped = await shipOrder(actor, { orderId: o.id, driverId, vehicleId, departAt: "2026-11-17T09:00", routeNotes: "I-25 north" });
    expect(shipped.manifestNumber).toMatch(/^MAN-\d{5}$/);
    expect(await pkg(whole.id)).toEqual({ quantity: "0", status: "FINISHED" });
    expect(await pkg(picked.id)).toEqual({ quantity: "0", status: "FINISHED" });
    expect((await pkg(big.id)).quantity).toBe("152");

    // 96 jars x $11 (VIP) + 150 pre-rolls shipped x $2.75 = 1056 + 412.50
    const [invoice] = await db.select().from(invoices).where(eq(invoices.orderId, o.id));
    expect(invoice.total).toBe("1468.50");
    expect(invoice.dueDate).toBe(addDays(todayIn(), 15));
    await expect(cancelOrder(actor, { orderId: o.id })).rejects.toThrow(/shipped/);

    await deliverOrder(actor, { orderId: o.id, receivedBy: "Pat at Mesa Retail" });
    expect((await order(o.id)).status).toBe("DELIVERED");

    await expect(recordPayment(actor, { invoiceId: invoice.id, amount: "2000", method: "CHECK", paidOn: todayIn() })).rejects.toThrow(/Only \$1468.50 is still owed/);
    await expect(recordPayment(actor, { invoiceId: invoice.id, amount: "10", method: "BITCOIN", paidOn: todayIn() })).rejects.toThrow(/how it was paid/);
    expect((await recordPayment(actor, { invoiceId: invoice.id, amount: "1000", method: "CHECK", paidOn: todayIn(), reference: "1042" })).balance).toBe("468.50");
    expect((await recordPayment(actor, { invoiceId: invoice.id, amount: "468.50", method: "CASH", paidOn: todayIn() })).balance).toBe("0.00");
    await expect(recordPayment(actor, { invoiceId: invoice.id, amount: "1", method: "CASH", paidOn: todayIn() })).rejects.toThrow(/already paid in full/);
    expect(await db.$count(payments, eq(payments.invoiceId, invoice.id))).toBe(2);
  });

  it("releases every package when an order is cancelled", async () => {
    const a = await receive(jars, "10");
    const o = await createOrder(actor, { customerId });
    await addOrderLine(actor, { orderId: o.id, itemId: jars, quantity: "10" });
    await confirmOrder(actor, { orderId: o.id });
    await allocateToOrder(actor, { orderId: o.id, lineId: await lineId(o.id, jars), tag: a.tag });
    await packOrder(actor, { orderId: o.id });
    await cancelOrder(actor, { orderId: o.id });
    expect(await pkg(a.id)).toEqual({ quantity: "10", status: "ACTIVE" });
    expect((await order(o.id)).status).toBe("CANCELLED");
    expect(await db.$count(invoices, eq(invoices.orderId, o.id))).toBe(0);
  });

  it("blocks shipping when the license has expired since the order was confirmed", async () => {
    const a = await receive(jars, "5");
    const o = await createOrder(actor, { customerId });
    await addOrderLine(actor, { orderId: o.id, itemId: jars, quantity: "5" });
    await confirmOrder(actor, { orderId: o.id });
    await allocateToOrder(actor, { orderId: o.id, lineId: await lineId(o.id, jars), tag: a.tag });
    await packOrder(actor, { orderId: o.id });
    await db.update(customers).set({ licenseExpires: addDays(todayIn(), -1) }).where(eq(customers.id, customerId));
    await expect(shipOrder(actor, { orderId: o.id, driverId, vehicleId, departAt: "2026-11-17T09:00" })).rejects.toThrow(/license expired/);
    expect((await pkg(a.id)).status).toBe("ALLOCATED");
    await expect(verifyCustomerLicense(actor, { customerId })).rejects.toThrow(/Enter the new expiry date/);
    await verifyCustomerLicense(actor, { customerId, licenseExpires: addDays(todayIn(), 365) });
    await shipOrder(actor, { orderId: o.id, driverId, vehicleId, departAt: "2026-11-17T09:00" });
  });

  it("keeps the ledger consistent with package quantities", async () => {
    const rows = await db.execute(sql`
      select p.id from packages p join inventory_transactions t on t.package_id = p.id
      where p.org_id = ${actor.orgId} group by p.id, p.quantity having sum(t.quantity_delta) <> p.quantity
    `);
    expect(rows.rows).toHaveLength(0);
  });
});
