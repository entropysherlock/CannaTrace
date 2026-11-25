// Project Apex II: financial regressions. APEX-13 (partial refunds), 14 (offline cash drawer), 15 (offline EACH), 16 (unit cost), 18 (discount cap).
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { discountPresets, drawerSessions, facilities, itemCategories, items, locations, organizations, packages, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { unitCost } from "@/lib/manufacturing-math";
import { recordOfflineSale } from "@/lib/offline-sales";
import { addToCart, checkInCustomer, closeDrawer, completeSale, createDiscount, openDrawer, returnSale, saveRetailSettings, setCartDiscount, setMenuItem, voidSale } from "@/lib/pos";
import { createPromotion, setPromotionActive } from "@/lib/promotions";
import { allocateToOrder, addOrderLine, confirmOrder, createCustomer, createDriver, createOrder, createVehicle, packOrder, shipOrder, verifyCustomerLicense } from "@/lib/distribution";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `AF${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const id = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };
let n = 0;
const tag = () => `${run}-${String(++n).padStart(5, "0")}`;

let A: Actor;
let A2: Actor;
let itemA: string; // $10.00, promoted 50%
let itemB: string; // $10.00, no promo
let itemW: string; // GRAM item for cost test
let loc: string;

async function receive(itemId: string, quantity: string, extra: { costPerUnit?: string } = {}) {
  const p = await receiveRaw(A, { tag: tag(), itemId, quantity, locationId: loc, ...extra });
  await addLabResult(A, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
  return p;
}

describe.skipIf(!hasDb)("Apex II financial fixes", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Fin ${run}` }).returning();
    const [f] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-F`, licenseType: "RETAIL", state: "NM" }).returning();
    const us = await db.insert(users).values([1, 2].map((k) => ({ orgId: org.id, name: `Cashier ${k}`, email: `c${k}.${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" as const }))).returning();
    const [l] = await db.insert(locations).values({ orgId: org.id, facilityId: f.id, name: "Floor", type: "ROOM" }).returning();
    loc = l.id;
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const mk = async (name: string, unit: "EACH" | "G") => (await db.insert(items).values({ orgId: org.id, name, sku: `${run}-${name}`, categoryId: cat.id, unit }).returning())[0].id;
    itemA = await mk("A", "EACH");
    itemB = await mk("B", "EACH");
    itemW = await mk("W", "G");
    A = { userId: us[0].id, userName: us[0].name, orgId: org.id, facilityId: f.id };
    A2 = { userId: us[1].id, userName: us[1].name, orgId: org.id, facilityId: f.id };
    await saveRetailSettings(A, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    for (const i of [itemA, itemB]) await setMenuItem(A, { itemId: i, price: "10.00", limitCategory: "NONE" });
    await createPromotion(A, { name: "Half off A", kind: "PERCENT", amount: "50", scope: "ITEM", itemId: itemA }, []);
    await openDrawer(A, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("APEX-13: a partial return refunds what that line cost, not an average share of the sale", async () => {
    await receive(itemA, "5");
    await receive(itemB, "5");
    const c = await checkInCustomer(A, id);
    await addToCart(A, { saleId: c.id, itemId: itemA, quantity: "1" });
    await addToCart(A, { saleId: c.id, itemId: itemB, quantity: "1" });
    const sale = await completeSale(A, { saleId: c.id, paymentMethod: "CASH", cashTendered: "100" });
    // $20 subtotal, $5 promo on A, taxable $15: excise 2.10 + sales 1.14 (1.14375) = total $18.24.
    expect(sale.total).toBe("18.24");
    const lines = (await db.execute<{ id: string; item_id: string }>(sql`select id, item_id from sale_lines where sale_id = ${c.id}`)).rows;
    const lineB = lines.find((l) => l.item_id === itemB)!.id;
    const lineA = lines.find((l) => l.item_id === itemA)!.id;
    const first = await returnSale(A, { saleId: c.id, lines: [{ saleLineId: lineB, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "unpromoted back" });
    expect(first.amount).toBe("12.16"); // 18.24 x 10/15, not 18.24 x 10/20 = 9.12
    const second = await returnSale(A, { saleId: c.id, lines: [{ saleLineId: lineA, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "rest" });
    expect(second.amount).toBe("6.08");
    const refunded = (await db.execute<{ s: string }>(sql`select sum(amount) s from sale_returns where sale_id = ${c.id}`)).rows[0].s;
    expect(new Decimal(refunded).toFixed(2)).toBe("18.24");
  });

  it("APEX-14: offline cash lands in the drawer it was rung up on, even after that drawer closed", async () => {
    await receive(itemB, "5");
    const [d1] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A.userId} and status = 'OPEN'`)).rows;
    const body = (offlineId: string, quantity = "1") => ({
      offlineId, localNumber: "OFF-1", facilityId: A.facilityId, sellerId: A.userId, sellerName: A.userName, drawerId: d1.id, soldAt: new Date(Date.now() - 60_000).toISOString(),
      customerType: "ADULT_USE" as const, birthDate: id.birthDate, idExpires: id.idExpires, lines: [{ itemId: itemB, name: "B", quantity, unitPrice: "10.00" }], discount: null,
      rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true }, total: "12.16", cashTendered: "20.00", changeDue: "7.84",
    });
    // The drawer is counted and closed with the offline sale's cash already inside it, before the sale reaches the server.
    await closeDrawer(A, { countedCash: "112.16" });
    const expectedAtClose = new Decimal((await db.select().from(drawerSessions).where(eq(drawerSessions.id, d1.id)))[0].expectedCash!);
    await openDrawer(A2, { openingCash: "50" });
    const [d2] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A2.userId} and status = 'OPEN'`)).rows;
    const synced = await recordOfflineSale(A2, body(crypto.randomUUID()));
    expect(synced.flagged).toBe(true);
    const row = (await db.execute<{ drawer_session_id: string; total: string }>(sql`select drawer_session_id, total from sales where id = ${synced.saleId}`)).rows[0];
    expect(row.drawer_session_id).toBe(d1.id);
    const afterClosed = (await db.select().from(drawerSessions).where(eq(drawerSessions.id, d1.id)))[0];
    expect(new Decimal(afterClosed.expectedCash!).toFixed(2)).toBe(expectedAtClose.add(row.total).toFixed(2));
    expect(afterClosed.status).toBe("CLOSED");
    const other = (await db.select().from(drawerSessions).where(eq(drawerSessions.id, d2.id)))[0];
    expect(other.status).toBe("OPEN");
    expect((await db.execute<{ n: number }>(sql`select count(*)::int n from sales where drawer_session_id = ${d2.id}`)).rows[0].n).toBe(0);
    // The same sale sent again changes nothing.
    const again = await recordOfflineSale(A2, body((await db.execute<{ o: string }>(sql`select offline_id o from sales where id = ${synced.saleId}`)).rows[0].o));
    expect(again.duplicate).toBe(true);
    expect(new Decimal((await db.select().from(drawerSessions).where(eq(drawerSessions.id, d1.id)))[0].expectedCash!).toFixed(2)).toBe(expectedAtClose.add(row.total).toFixed(2));
  });

  it("APEX-15: an offline sale cannot carry a fraction of an item counted each", async () => {
    await receive(itemB, "5");
    const [d] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A2.userId} and status = 'OPEN'`)).rows;
    await expect(
      recordOfflineSale(A2, {
        offlineId: crypto.randomUUID(), localNumber: "OFF-2", facilityId: A2.facilityId, sellerId: A2.userId, sellerName: A2.userName, drawerId: d.id, soldAt: new Date(Date.now() - 60_000).toISOString(),
        customerType: "ADULT_USE" as const, birthDate: id.birthDate, idExpires: id.idExpires, lines: [{ itemId: itemB, name: "B", quantity: "1.5", unitPrice: "10.00" }], discount: null,
        rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true }, total: "18.24", cashTendered: "20.00", changeDue: "1.76",
      }),
    ).rejects.toThrow(/whole number/);
  });

  it("APEX-16: a very small cost per unit is kept instead of rounding to zero", async () => {
    expect(unitCost(new Decimal(1), new Decimal(0), new Decimal(100000))!.toString()).toBe("0.00001");
    expect(unitCost(new Decimal(10), new Decimal(0), new Decimal(3))!.toString()).toBe("3.33333333");
    const p = await receive(itemW, "10", { costPerUnit: "0.00001234" });
    const [row] = await db.select().from(packages).where(eq(packages.id, p.id));
    expect(new Decimal(row.costPerUnit!).toString()).toBe("0.00001234");
  });

  it("APEX-18: a discount preset cannot take 100% off", async () => {
    await expect(createDiscount(A, { name: `Free ${run}`, percent: "100" })).rejects.toThrow(InventoryError);
    await expect(createDiscount(A, { name: `Free ${run}`, percent: "90.001" })).rejects.toThrow(/more than 90|cannot be more than/);
    await createDiscount(A, { name: `Big ${run}`, percent: "90" });
  });

  it("APEX-35: a 90% promotion plus a 90% cart discount cannot stack into a near-free sale", async () => {
    const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, A.orgId));
    const [it] = await db.insert(items).values({ orgId: A.orgId, name: "Stack", sku: `${run}-STK`, categoryId: cat.id, unit: "EACH" }).returning();
    await setMenuItem(A, { itemId: it.id, price: "100.00", limitCategory: "NONE" });
    await receive(it.id, "5");
    const promo = await createPromotion(A, { name: `Stack ${run}`, kind: "PERCENT", amount: "90", scope: "ITEM", itemId: it.id }, []);
    await createDiscount(A, { name: `Stack90 ${run}`, percent: "90" });
    const [preset] = await db.select().from(discountPresets).where(and(eq(discountPresets.orgId, A.orgId), eq(discountPresets.name, `Stack90 ${run}`)));
    const c = await checkInCustomer(A2, id);
    await addToCart(A2, { saleId: c.id, itemId: it.id, quantity: "1" });
    await setCartDiscount(A2, { saleId: c.id, discountId: preset.id });
    await expect(completeSale(A2, { saleId: c.id, paymentMethod: "CASH", cashTendered: "100" })).rejects.toThrow(/together take more than 90%/);
    await setCartDiscount(A2, { saleId: c.id, discountId: "" });
    await completeSale(A2, { saleId: c.id, paymentMethod: "CASH", cashTendered: "100" });
    await setPromotionActive(A, promo.id, false);
  });

  it("APEX-17: a retail return into a package already reserved for a wholesale order is billed when it ships", async () => {
    const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, A.orgId));
    const [fresh] = await db.insert(items).values({ orgId: A.orgId, name: "C", sku: `${run}-C`, categoryId: cat.id, unit: "EACH" }).returning();
    await setMenuItem(A, { itemId: fresh.id, price: "10.00", limitCategory: "NONE" });
    const p = await receive(fresh.id, "10");
    const c = await checkInCustomer(A2, id);
    await addToCart(A2, { saleId: c.id, itemId: fresh.id, quantity: "3" });
    await completeSale(A2, { saleId: c.id, paymentMethod: "CASH", cashTendered: "100" });
    const exp = addDays(today, 900);
    const cust = await createCustomer(A2, { name: `W ${run}`, licenseNumber: `${run}-WC`, licenseType: "Retailer", licenseExpires: exp, paymentTermsDays: "15" });
    await verifyCustomerLicense(A2, { customerId: cust.id });
    const drv = await createDriver(A2, { name: "Dana", licenseNumber: `${run}-D` });
    const veh = await createVehicle(A2, { make: "Ford", model: "Transit", plate: run.slice(0, 8) });
    const order = await createOrder(A2, { customerId: cust.id });
    await addOrderLine(A2, { orderId: order.id, itemId: fresh.id, quantity: "7", unitPrice: "5.00" });
    await confirmOrder(A2, { orderId: order.id });
    const lineId = (await db.execute<{ id: string }>(sql`select id from order_lines where order_id = ${order.id}`)).rows[0].id;
    await allocateToOrder(A2, { orderId: order.id, lineId, tag: (await db.select().from(packages).where(eq(packages.id, p.id)))[0].tag });
    const saleLine = (await db.execute<{ id: string }>(sql`select id from sale_lines where sale_id = ${c.id}`)).rows[0].id;
    await returnSale(A2, { saleId: c.id, lines: [{ saleLineId: saleLine, quantity: "3" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "customer changed mind" });
    await packOrder(A2, { orderId: order.id });
    const shipped = await shipOrder(A2, { orderId: order.id, driverId: drv.id, vehicleId: veh.id, departAt: `${today}T10:00` });
    const inv = (await db.execute<{ total: string }>(sql`select total from invoices where number = ${shipped.invoiceNumber} and facility_id = ${A2.facilityId}`)).rows[0];
    const unitsShipped = new Decimal((await db.execute<{ q: string }>(sql`select -quantity_delta q from inventory_transactions where package_id = ${p.id} and type = 'SELL' order by created_at desc limit 1`)).rows[0].q);
    // Whatever physically leaves on the manifest must be on the invoice.
    expect(new Decimal(inv.total).toFixed(2)).toBe(unitsShipped.mul(5).toFixed(2));
  });

  it("APEX-33: voiding a retail sale into a package already reserved for a wholesale order is billed when it ships", async () => {
    const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, A.orgId));
    const [fresh] = await db.insert(items).values({ orgId: A.orgId, name: "C2", sku: `${run}-C2`, categoryId: cat.id, unit: "EACH" }).returning();
    await setMenuItem(A, { itemId: fresh.id, price: "10.00", limitCategory: "NONE" });
    const p = await receive(fresh.id, "10");
    const c = await checkInCustomer(A2, id);
    await addToCart(A2, { saleId: c.id, itemId: fresh.id, quantity: "3" });
    await completeSale(A2, { saleId: c.id, paymentMethod: "CASH", cashTendered: "100" });
    const exp = addDays(today, 900);
    const cust = await createCustomer(A2, { name: `W2 ${run}`, licenseNumber: `${run}-WC2`, licenseType: "Retailer", licenseExpires: exp, paymentTermsDays: "15" });
    await verifyCustomerLicense(A2, { customerId: cust.id });
    const drv = await createDriver(A2, { name: "Dana", licenseNumber: `${run}-D2` });
    const veh = await createVehicle(A2, { make: "Ford", model: "Transit", plate: `${run}`.slice(2, 9) + "9" });
    const order = await createOrder(A2, { customerId: cust.id });
    await addOrderLine(A2, { orderId: order.id, itemId: fresh.id, quantity: "7", unitPrice: "5.00" });
    await confirmOrder(A2, { orderId: order.id });
    const lineId = (await db.execute<{ id: string }>(sql`select id from order_lines where order_id = ${order.id}`)).rows[0].id;
    await allocateToOrder(A2, { orderId: order.id, lineId, tag: (await db.select().from(packages).where(eq(packages.id, p.id)))[0].tag });
    const saleLine = (await db.execute<{ id: string }>(sql`select id from sale_lines where sale_id = ${c.id}`)).rows[0].id;
    void saleLine;
    await voidSale(A2, { saleId: c.id, reason: "rung up by mistake" });
    await packOrder(A2, { orderId: order.id });
    const shipped = await shipOrder(A2, { orderId: order.id, driverId: drv.id, vehicleId: veh.id, departAt: `${today}T10:00` });
    const inv = (await db.execute<{ total: string }>(sql`select total from invoices where number = ${shipped.invoiceNumber} and facility_id = ${A2.facilityId}`)).rows[0];
    const unitsShipped = new Decimal((await db.execute<{ q: string }>(sql`select -quantity_delta q from inventory_transactions where package_id = ${p.id} and type = 'SELL' order by created_at desc limit 1`)).rows[0].q);
    // Whatever physically leaves on the manifest must be on the invoice.
    expect(new Decimal(inv.total).toFixed(2)).toBe(unitsShipped.mul(5).toFixed(2));
  });
});
