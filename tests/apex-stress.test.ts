/**
 * Project Apex: one million historical transactions. Only runs when APEX_STRESS=1 (it takes several minutes and
 * writes a lot of rows). Loads a million completed sales with two lines each straight into a real database, then
 * times the app's own read paths and a burst of live sales against that history.
 */
import { and, eq, sql } from "drizzle-orm";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drawerSessions, facilities, itemCategories, items, locations, organizations, users } from "@/db/schema";
import { commandCenter } from "@/lib/dashboard";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage, type Actor } from "@/lib/inventory";
import { addToCart, checkInCustomer, completeSale, drawerSummary, openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";
import { reviewCount, reviewQueue } from "@/lib/offline-sales";
import { todayList } from "@/lib/today";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const on = Boolean(process.env.DATABASE_URL) && process.env.APEX_STRESS === "1";
const ROWS = Number(process.env.APEX_STRESS_ROWS ?? 1_000_000);
const run = `ST${Date.now().toString(36).toUpperCase()}`;
const out: Record<string, unknown> = { rows: ROWS };

const pct = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return Number(a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2)); };
async function time(name: string, reps: number, f: () => Promise<unknown>) {
  const xs: number[] = [];
  for (let i = 0; i < reps; i++) { const t = performance.now(); await f(); xs.push(performance.now() - t); }
  out[name] = { reps, p50: pct(xs, 0.5), p95: pct(xs, 0.95), p99: pct(xs, 0.99), max: pct(xs, 1) };
}

describe.skipIf(!on)("Apex stress: a million historical sales", () => {
  let actor: Actor; let orgId: string; let facId: string; let itemIds: string[]; let locId: string; let drawerIds: string[] = [];
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Stress ${run}` }).returning();
    const [fac] = await db.insert(facilities).values({ orgId: org.id, name: "Stress Shop", licenseNumber: `${run}-1`, licenseType: "RETAIL", state: "NM" }).returning();
    const us = await db.insert(users).values(Array.from({ length: 20 }, (_, k) => ({ orgId: org.id, name: `Cashier ${k}`, email: `${run.toLowerCase()}${k}@test.invalid`, passwordHash: "x", role: "MANAGER" as const }))).returning();
    const [loc] = await db.insert(locations).values({ orgId: org.id, facilityId: fac.id, name: "Floor", type: "ROOM" }).returning();
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db.insert(items).values(Array.from({ length: 100 }, (_, i) => ({ orgId: org.id, name: `Stress SKU ${i}`, sku: `${run}-${i}`, categoryId: cat.id, unit: "EACH" as const }))).returning();
    orgId = org.id; facId = fac.id; itemIds = made.map((i) => i.id); locId = loc.id;
    actor = { userId: us[0].id, userName: us[0].name, orgId, facilityId: facId };
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    for (const id of itemIds) await setMenuItem(actor, { itemId: id, price: "12.34", limitCategory: "NONE" });
    // 3,650 closed drawers (a year of two shifts a day for five stores' worth of history).
    const base = Date.now();
    const rows = Array.from({ length: 3650 }, (_, g) => ({ orgId, facilityId: facId, userId: us[0].id, openedByName: "Cashier 0", closedByName: "Cashier 0", status: "CLOSED" as const, openingCash: "100", countedCash: "100", expectedCash: "100", openedAt: new Date(base - g * 3_600_000), closedAt: new Date(base - g * 3_600_000 + 1000) }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(drawerSessions).values(rows.slice(i, i + 500) as never);
    drawerIds = (await db.select({ id: drawerSessions.id }).from(drawerSessions).where(eq(drawerSessions.facilityId, facId))).map((r) => r.id);
  }, 600_000);
  afterAll(() => { fs.writeFileSync(process.env.APEX_PERF_OUT ?? "/tmp/apex-stress.json", JSON.stringify(out, null, 2)); return pool.end(); });

  it("loads a million sales and two million lines", async () => {
    const t = performance.now();
    const step = 100_000;
    for (let from = 1; from <= ROWS; from += step) {
      const to = Math.min(ROWS, from + step - 1);
      await db.execute(sql`insert into sales (id, org_id, facility_id, drawer_session_id, number, status, customer_type, subtotal, discount_total, excise_tax, sales_tax, total, payment_method, cash_tendered, debit_amount, change_due, user_id, user_name, created_at, completed_at)
        select 'sale-' || ${run} || '-' || g, ${orgId}, ${facId}, (array(select id from drawer_sessions where facility_id = ${facId} order by id))[1 + (g % ${drawerIds.length}::int)], 'H-' || lpad(g::text, 8, '0'), 'COMPLETED', 'ADULT_USE',
          24.68, 0, 3.46, 1.88, 30.02, 'CASH', 40, 0, 9.98, (select id from users where org_id = ${orgId} limit 1), 'Cashier', now() - ((g % 365) || ' days')::interval - ((g % 1440) || ' minutes')::interval, now() - ((g % 365) || ' days')::interval - ((g % 1440) || ' minutes')::interval
        from generate_series(${from}::int, ${to}::int) g`);
      await db.execute(sql`insert into sale_lines (id, sale_id, item_id, quantity, unit_price)
        select gen_random_uuid()::text, 'sale-' || ${run} || '-' || g, (array(select id from items where org_id = ${orgId} order by id))[1 + ((g + k) % 100)], 1, 12.34 from generate_series(${from}::int, ${to}::int) g, generate_series(1, 2) k`);
    }
    await db.execute(sql`analyze sales`); await db.execute(sql`analyze sale_lines`);
    out.loadSeconds = Number(((performance.now() - t) / 1000).toFixed(1));
    const [{ n }] = (await db.execute<{ n: string }>(sql`select count(*) n from sales where org_id = ${orgId}`)).rows;
    expect(Number(n)).toBe(ROWS);
  }, 3_600_000);

  it("read paths stay fast against a million sales", async () => {
    const [drawer] = await db.select().from(drawerSessions).where(eq(drawerSessions.id, drawerIds[0]));
    await time("drawerSummary(~270 sales)", 20, () => drawerSummary(db, drawer));
    await time("reviewCount", 20, () => reviewCount(facId));
    await time("reviewQueue", 20, () => reviewQueue(actor));
    await time("commandCenter(30d)", 5, () => commandCenter(orgId, [facId], 30));
    await time("commandCenter(90d)", 5, () => commandCenter(orgId, [facId], 90));
    await time("todayList", 10, () => todayList({ orgId, facilityIds: [facId], today: todayIn(), may: { sales: true, inventory: true, cultivation: true } }));
    await time("sale by number (index)", 50, () => db.execute(sql`select id from sales where facility_id = ${facId} and number = 'H-00500000'`));
    await time("sales for one day (facility, date range)", 10, () => db.execute(sql`select count(*), sum(total) from sales where facility_id = ${facId} and completed_at >= now() - interval '1 day'`));
    out.explainSalesByDate = (await db.execute<{ "QUERY PLAN": string }>(sql`explain select count(*), sum(total) from sales where facility_id = ${facId} and completed_at >= now() - interval '1 day'`)).rows.map((r) => r["QUERY PLAN"]);
    out.rssMB = Math.round(process.memoryUsage().rss / 1048576);
  }, 900_000);

  it("a burst of live sales across many registers stays correct with the history loaded", async () => {
    const regs: Actor[] = [];
    const us = (await db.select().from(users).where(eq(users.orgId, orgId))).slice(0, 12);
    for (const u of us) { const a: Actor = { userId: u.id, userName: u.name, orgId, facilityId: facId }; regs.push(a); await openDrawer(a, { openingCash: "100" }); }
    for (let k = 0; k < 4; k++) {
      const p = await receivePackage(actor, { tag: `${run}-P${k}`, itemId: itemIds[k], quantity: "4000", locationId: locId });
      await addLabResult(actor, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    }
    const idc = { birthDate: "1990-05-05", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" };
    const errors: string[] = [];
    const lat: number[] = [];
    const t0 = performance.now();
    await Promise.all(regs.map(async (a, r) => {
      for (let i = 0; i < 40; i++) {
        const t = performance.now();
        try {
          const c = await checkInCustomer(a, idc);
          await addToCart(a, { saleId: c.id, itemId: itemIds[(r + i) % 4], quantity: "1" });
          await completeSale(a, { saleId: c.id, paymentMethod: "CASH", cashTendered: "50" });
        } catch (e) { errors.push((e as Error).message.slice(0, 120)); }
        lat.push(performance.now() - t);
      }
    }));
    const secs = (performance.now() - t0) / 1000;
    out.burst = { registers: regs.length, attempted: regs.length * 40, errors: errors.length, errorSamples: [...new Set(errors)].slice(0, 5), seconds: Number(secs.toFixed(1)), salesPerSecond: Number(((regs.length * 40 - errors.length) / secs).toFixed(1)), p50: pct(lat, 0.5), p95: pct(lat, 0.95), p99: pct(lat, 0.99) };
    const deadlocks = errors.filter((m) => /deadlock|connection|timeout|too many/i.test(m));
    expect(deadlocks).toEqual([]);
    // Stock taken equals units sold, nothing negative.
    const [{ bad }] = (await db.execute<{ bad: string }>(sql`select count(*) bad from packages where org_id = ${orgId} and quantity < 0`)).rows;
    expect(bad).toBe("0");
    const [{ sold, took }] = (await db.execute<{ sold: string; took: string }>(sql`select (select count(*) from sales where org_id = ${orgId} and number not like 'H-%' and status = 'COMPLETED') sold, (select coalesce(-sum(quantity_delta),0) from inventory_transactions where org_id = ${orgId} and type = 'SELL') took`)).rows;
    expect(Number(took)).toBe(Number(sold));
    void and;
  }, 900_000);
});
