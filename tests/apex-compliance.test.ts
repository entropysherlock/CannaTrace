// Project Apex II: compliance regressions (APEX-22 to APEX-30).
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { facilities, itemCategories, items, locations, organizations, retailSettings, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { recordOfflineSale } from "@/lib/offline-sales";
import { allocateToOrder, addOrderLine, confirmOrder, createCustomer, createDriver, createOrder, createVehicle, packOrder, shipOrder, verifyCustomerLicense } from "@/lib/distribution";
import { splitPackage } from "@/lib/inventory";
import { addToCart, checkInCustomer, completeSale, getRetailSettings, openDrawer, removeFromCart, saveRetailSettings, setLineQuantity, setMenuItem } from "@/lib/pos";
import { fakeAssistantOn } from "@/lib/ai/connection";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `AC${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const idDates = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };
let n = 0;
const tag = () => `${run}-${String(++n).padStart(5, "0")}`;

let A: Actor; // NM store with per-day limits on
let flower: string;
let loc: string;
let CA: Actor; // California store, first-time settings

describe.skipIf(!hasDb)("Apex II compliance", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Comp ${run}` }).returning();
    const [f] = await db.insert(facilities).values({ orgId: org.id, name: "NM Shop", licenseNumber: `${run}-NM`, licenseType: "RETAIL", state: "NM" }).returning();
    const [fca] = await db.insert(facilities).values({ orgId: org.id, name: "CA Shop", licenseNumber: `${run}-CA`, licenseType: "RETAIL", state: "CA" }).returning();
    const [u] = await db.insert(users).values({ orgId: org.id, name: "Mgr", email: `m.${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [l] = await db.insert(locations).values({ orgId: org.id, facilityId: f.id, name: "Floor", type: "ROOM" }).returning();
    loc = l.id;
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const [it] = await db.insert(items).values({ orgId: org.id, name: "Flower jar", sku: `${run}-FL`, categoryId: cat.id, unit: "EACH" }).returning();
    flower = it.id;
    A = { userId: u.id, userName: u.name, orgId: org.id, facilityId: f.id };
    CA = { ...A, facilityId: fca.id };
    await saveRetailSettings(A, { flowerLimitGrams: "7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true, dailyLimits: true });
    await setMenuItem(A, { itemId: flower, price: "10.00", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await openDrawer(A, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("APEX-22: a state with per-day limits starts with daily limits on", async () => {
    expect((await getRetailSettings(db, CA.facilityId)).dailyLimits).toBe(true);
    await saveRetailSettings(CA, { flowerLimitGrams: "28", concentrateLimitGrams: "8", edibleLimitMg: "1000", exciseTaxPercent: "15", salesTaxPercent: "8", medicalTaxExempt: false });
    const [row] = await db.select().from(retailSettings).where(eq(retailSettings.facilityId, CA.facilityId));
    expect(row.dailyLimits).toBe(true);
  });

  it("APEX-23: an offline sale counts toward the customer's later purchases the same day", async () => {
    const p = await receiveRaw(A, { tag: tag(), itemId: flower, quantity: "20", locationId: loc });
    await addLabResult(A, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    const [d] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A.userId} and status = 'OPEN'`)).rows;
    const offline = (idNumber?: string) => ({
      offlineId: crypto.randomUUID(), localNumber: "OFF-1", facilityId: A.facilityId, sellerId: A.userId, sellerName: A.userName, drawerId: d.id, soldAt: new Date(Date.now() - 60_000).toISOString(),
      customerType: "ADULT_USE" as const, birthDate: idDates.birthDate, idExpires: idDates.idExpires, ...(idNumber ? { idNumber } : {}),
      lines: [{ itemId: flower, name: "Flower jar", quantity: "2", unitPrice: "10.00" }], discount: null,
      rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true }, total: "24.32", cashTendered: "30.00", changeDue: "5.68",
    });
    const noId = await recordOfflineSale(A, offline());
    expect(noId.flagged).toBe(true);
    const sync = await recordOfflineSale(A, offline(`DL-${run}`));
    expect(sync.duplicate).toBe(false);
    const [row] = (await db.execute<{ customer_key: string | null }>(sql`select customer_key from sales where id = ${sync.saleId}`)).rows;
    expect(row.customer_key).toBeTruthy();
    // The same person comes to the register: 2 jars (7 g) were already bought, so even one more passes the 7 g limit.
    const cart = await checkInCustomer(A, { ...idDates, idNumber: `DL-${run}` });
    await expect(addToCart(A, { saleId: cart.id, itemId: flower, quantity: "1" }).then(() => completeSale(A, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "50" }))).rejects.toThrow(/limit/i);
    // A second offline sale by that person is flagged for the limit when it syncs.
    const second = await recordOfflineSale(A, offline(`DL-${run}`));
    const [note] = (await db.execute<{ review_note: string | null }>(sql`select review_note from sales where id = ${second.saleId}`)).rows;
    expect(note.review_note).toMatch(/Purchase limit/);
  });

  it("APEX-26: untested product cannot be shipped to a retailer in a state that tests before retail sale", async () => {
    const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, A.orgId));
    const [it] = await db.insert(items).values({ orgId: A.orgId, name: "Untested", sku: `${run}-UT`, categoryId: cat.id, unit: "G" }).returning();
    const p = await receiveRaw(A, { tag: tag(), itemId: it.id, quantity: "100", locationId: loc });
    const exp = addDays(today, 900);
    const retailer = await createCustomer(A, { name: `Retailer ${run}`, licenseNumber: `${run}-R`, licenseType: "Retailer", licenseExpires: exp, paymentTermsDays: "15" });
    await verifyCustomerLicense(A, { customerId: retailer.id });
    const drv = await createDriver(A, { name: "Dana", licenseNumber: `${run}-D` });
    const veh = await createVehicle(A, { make: "Ford", model: "Transit", plate: run.slice(0, 8) });
    const order = await createOrder(A, { customerId: retailer.id });
    await addOrderLine(A, { orderId: order.id, itemId: it.id, quantity: "100", unitPrice: "3.00" });
    await confirmOrder(A, { orderId: order.id });
    const lineId = (await db.execute<{ id: string }>(sql`select id from order_lines where order_id = ${order.id}`)).rows[0].id;
    await allocateToOrder(A, { orderId: order.id, lineId, tag: (await db.execute<{ tag: string }>(sql`select tag from packages where id = ${p.id}`)).rows[0].tag });
    await packOrder(A, { orderId: order.id });
    await expect(shipOrder(A, { orderId: order.id, driverId: drv.id, vehicleId: veh.id, departAt: `${today}T10:00` })).rejects.toThrow(/no passing lab result/);
    await addLabResult(A, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    const shipped = await shipOrder(A, { orderId: order.id, driverId: drv.id, vehicleId: veh.id, departAt: `${today}T10:00` });
    expect(shipped.invoiceNumber).toBeTruthy();
  });

  it("APEX-27: a child split from a passing package inherits its passing result and can be sold", async () => {
    const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, A.orgId));
    const [it] = await db.insert(items).values({ orgId: A.orgId, name: "Splittable", sku: `${run}-SP`, categoryId: cat.id, unit: "EACH" }).returning();
    await setMenuItem(A, { itemId: it.id, price: "5.00", limitCategory: "NONE" });
    const p = await receiveRaw(A, { tag: tag(), itemId: it.id, quantity: "10", locationId: loc });
    await addLabResult(A, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    const { children } = await splitPackage(A, { packageId: p.id, parts: [{ tag: tag(), quantity: 4 }] });
    expect(children).toHaveLength(1);
    const c = await checkInCustomer(A, { ...idDates, idNumber: `DL2-${run}` });
    // 8 units cannot come from the 6 left in the parent alone, so the child is used too.
    await addToCart(A, { saleId: c.id, itemId: it.id, quantity: "8" });
    const sale = await completeSale(A, { saleId: c.id, paymentMethod: "CASH", cashTendered: "100" });
    expect(sale.number).toBeTruthy();
    const used = (await db.execute<{ n: number }>(sql`select count(*)::int n from sale_line_packages slp join sale_lines sl on sl.id = slp.sale_line_id where sl.item_id = ${it.id}`)).rows[0].n;
    expect(used).toBe(2);
  });
  it("APEX-29: the stand-in Tally model is off on a Vercel production deployment", () => {
    const before = { fake: process.env.ASSISTANT_FAKE, vercel: process.env.VERCEL_ENV };
    try {
      process.env.ASSISTANT_FAKE = "1";
      process.env.VERCEL_ENV = "production";
      expect(fakeAssistantOn()).toBe(false);
      process.env.VERCEL_ENV = "preview";
      expect(fakeAssistantOn()).toBe(true);
    } finally {
      if (before.fake === undefined) delete process.env.ASSISTANT_FAKE; else process.env.ASSISTANT_FAKE = before.fake;
      if (before.vercel === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = before.vercel;
    }
  });

  it("APEX-30: removing or reducing cart lines, and attaching or detaching rewards, leave audit rows", async () => {
    const c = await checkInCustomer(A, { ...idDates, idNumber: `DL3-${run}` });
    await addToCart(A, { saleId: c.id, itemId: flower, quantity: "2" });
    const [line] = (await db.execute<{ id: string }>(sql`select id from sale_lines where sale_id = ${c.id}`)).rows;
    await setLineQuantity(A, { lineId: line.id, quantity: "1" });
    await removeFromCart(A, { lineId: line.id });
    const actions = (await db.execute<{ action: string }>(sql`select action from audit_logs where entity_id = ${c.id} order by created_at`)).rows.map((r) => r.action);
    expect(actions).toContain("CART_QUANTITY_REDUCED");
    expect(actions).toContain("CART_LINE_REMOVED");
  });
  it("APEX-32: a synced offline sale is queued for state reporting like any other retail sale", async () => {
    const p = await receiveRaw(A, { tag: tag(), itemId: flower, quantity: "5", locationId: loc });
    await addLabResult(A, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    const [d] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A.userId} and status = 'OPEN'`)).rows;
    const r = await recordOfflineSale(A, {
      offlineId: crypto.randomUUID(), localNumber: "OFF-Q", facilityId: A.facilityId, sellerId: A.userId, sellerName: A.userName, drawerId: d.id, soldAt: new Date(Date.now() - 60_000).toISOString(),
      customerType: "ADULT_USE", birthDate: idDates.birthDate, idExpires: idDates.idExpires, idNumber: `DLQ-${run}`,
      lines: [{ itemId: flower, name: "Flower jar", quantity: "1", unitPrice: "10.00" }], discount: null,
      rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true }, total: "12.17", cashTendered: "20.00", changeDue: "7.83",
    });
    const queued = (await db.execute<{ type: string }>(sql`select type from sync_events where entity_id = ${r.saleId}`)).rows;
    expect(queued.map((q) => q.type)).toContain("RETAIL_SALE");
  });

  it("APEX-36: two simultaneous syncs of one offline sale record it once and report a duplicate", async () => {
    const p = await receiveRaw(A, { tag: tag(), itemId: flower, quantity: "5", locationId: loc });
    await addLabResult(A, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    const [d] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A.userId} and status = 'OPEN'`)).rows;
    const sale = {
      offlineId: crypto.randomUUID(), localNumber: "OFF-DUP", facilityId: A.facilityId, sellerId: A.userId, sellerName: A.userName, drawerId: d.id, soldAt: new Date(Date.now() - 60_000).toISOString(),
      customerType: "ADULT_USE" as const, birthDate: idDates.birthDate, idExpires: idDates.idExpires, idNumber: `DLD-${run}`,
      lines: [{ itemId: flower, name: "Flower jar", quantity: "1", unitPrice: "10.00" }], discount: null,
      rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true }, total: "12.17", cashTendered: "20.00", changeDue: "7.83",
    };
    const results = await Promise.all([recordOfflineSale(A, sale), recordOfflineSale(A, sale), recordOfflineSale(A, sale)]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.saleId)).size).toBe(1);
    const n = (await db.execute<{ n: number }>(sql`select count(*)::int n from sales where offline_id = ${sale.offlineId}`)).rows[0].n;
    expect(n).toBe(1);
  });

});
