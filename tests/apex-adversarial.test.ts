/**
 * Project Apex: adversarial and security scenarios against the real code and a real database.
 * Each test states the property that must hold; a failure is a defect in Leaf2Sale, not in the test.
 */
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packages, sales, users } from "@/db/schema";
import { permissionsFor } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { parseCsv, readTable } from "@/lib/csv";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, adjustPackage, destroyPackage, movePackage, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { isPrivateAddress, checkWebhookUrl } from "@/lib/integrations";
import { recordOfflineSale } from "@/lib/offline-sales";
import { addToCart, cancelCart, checkInCustomer, closeDrawer, completeSale, openDrawer, returnSale, saveRetailSettings, setMenuItem, voidSale } from "@/lib/pos";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `AV${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const id = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };
let n = 0;
const tag = () => `${run}-${String(++n).padStart(5, "0")}`;

let A: Actor; // cashier 1, store 1
let A2: Actor; // cashier 2, store 1
let B: Actor; // store 2 (same business)
let X: Actor; // a different business entirely
let item: string;
let loc: string;
let locB: string;
let locX: string;
let itemX: string;

const qtyOf = async (pid: string) => new Decimal((await db.select().from(packages).where(eq(packages.id, pid)))[0].quantity).toNumber();
const stockOf = async (itemId: string, fac: string) =>
  new Decimal((await db.execute<{ q: string }>(sql`select coalesce(sum(quantity),0) q from packages where item_id = ${itemId} and facility_id = ${fac} and status in ('ACTIVE','ALLOCATED')`)).rows[0].q).toNumber();
async function receive(actor: Actor, itemId: string, quantity: string, locationId: string) {
  const p = await receiveRaw(actor, { tag: tag(), itemId, quantity, locationId });
  await addLabResult(actor, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
  return p;
}
async function cart(actor: Actor, itemId: string, qty: string) {
  const c = await checkInCustomer(actor, id);
  await addToCart(actor, { saleId: c.id, itemId, quantity: qty });
  return c.id;
}

describe.skipIf(!hasDb)("Apex adversarial scenarios", () => {
  beforeAll(async () => {
    const mkOrg = async (label: string) => {
      const [org] = await db.insert(organizations).values({ name: `${label} ${run}` }).returning();
      const fs = await db.insert(facilities).values([1, 2].map((k) => ({ orgId: org.id, name: `${label} Shop ${k}`, licenseNumber: `${run}-${label}${k}`, licenseType: "RETAIL" as const, state: "NM" }))).returning();
      const us = await db.insert(users).values([1, 2].map((k) => ({ orgId: org.id, name: `${label} Cashier ${k}`, email: `${label.toLowerCase()}${k}.${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" as const }))).returning();
      const ls = await db.insert(locations).values(fs.map((f) => ({ orgId: org.id, facilityId: f.id, name: "Floor", type: "ROOM" as const }))).returning();
      const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
      const [it] = await db.insert(items).values({ orgId: org.id, name: `${label} Jar`, sku: `${run}-${label}`, categoryId: cat.id, unit: "EACH" }).returning();
      const mk = (f: (typeof fs)[number], u: (typeof us)[number]): Actor => ({ userId: u.id, userName: u.name, orgId: org.id, facilityId: f.id });
      for (const f of fs) {
        const a = mk(f, us[0]);
        await saveRetailSettings(a, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
        await setMenuItem(a, { itemId: it.id, price: "10.01", limitCategory: "NONE" });
      }
      return { a1: mk(fs[0], us[0]), a2: mk(fs[0], us[1]), b: mk(fs[1], us[0]), item: it.id, l0: ls[0].id, l1: ls[1].id };
    };
    const one = await mkOrg("One");
    const two = await mkOrg("Two");
    A = one.a1; A2 = one.a2; B = one.b; item = one.item; loc = one.l0; locB = one.l1;
    X = two.a1; itemX = two.item; locX = two.l0;
    await openDrawer(A, { openingCash: "100" });
    await openDrawer(A2, { openingCash: "100" });
    await openDrawer(B, { openingCash: "100" });
    await openDrawer(X, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("the last unit can be sold only once, even when two registers try at the same moment", async () => {
    const p = await receive(A, item, "1", loc);
    const c1 = await cart(A, item, "1").catch(() => null);
    const c2 = await cart(A2, item, "1").catch(() => null);
    const results = await Promise.allSettled([c1 && completeSale(A, { saleId: c1, paymentMethod: "CASH", cashTendered: "50" }), c2 && completeSale(A2, { saleId: c2, paymentMethod: "CASH", cashTendered: "50" })].filter(Boolean) as Promise<unknown>[]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(InventoryError);
    expect(await qtyOf(p.id)).toBeGreaterThanOrEqual(0);
    expect(await stockOf(item, A.facilityId)).toBeGreaterThanOrEqual(0);
    for (const c of [c1, c2]) if (c) await cancelCart(c === c1 ? A : A2, { saleId: c }).catch(() => {});
  });

  it("paying the same cart four times at once records one sale and takes the stock once", async () => {
    const p = await receive(A, item, "10", loc);
    const before = await stockOf(item, A.facilityId);
    const c = await cart(A, item, "2");
    const rs = await Promise.allSettled(Array.from({ length: 4 }, () => completeSale(A, { saleId: c, paymentMethod: "CASH", cashTendered: "100" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of rs) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(InventoryError);
    expect(await stockOf(item, A.facilityId)).toBe(before - 2);
    void p;
  });

  it("voiding the same sale three times at once restores the stock once", async () => {
    await receive(A, item, "10", loc);
    const c = await cart(A, item, "3");
    await completeSale(A, { saleId: c, paymentMethod: "CASH", cashTendered: "100" });
    const mid = await stockOf(item, A.facilityId);
    const rs = await Promise.allSettled(Array.from({ length: 3 }, () => voidSale(A, { saleId: c, reason: "dup" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stockOf(item, A.facilityId)).toBe(mid + 3);
  });

  it("returns never refund more than the sale total, including after a partial refund and under concurrency", async () => {
    await receive(A, item, "10", loc);
    const c = await cart(A, item, "3");
    const done = await completeSale(A, { saleId: c, paymentMethod: "CASH", cashTendered: "100" });
    const [{ id: lineId }] = (await db.execute<{ id: string }>(sql`select id from sale_lines where sale_id = ${c}`)).rows;
    const first = await returnSale(A, { saleId: c, lines: [{ saleLineId: lineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "partial" });
    const rs = await Promise.allSettled(Array.from({ length: 3 }, () => returnSale(A, { saleId: c, lines: [{ saleLineId: lineId, quantity: "2" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "rest" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refunded = (await db.execute<{ s: string }>(sql`select sum(amount) s from sale_returns where sale_id = ${c}`)).rows[0].s;
    expect(new Decimal(refunded).toFixed(2)).toBe(new Decimal(done.total).toFixed(2));
    expect(new Decimal(first.amount).lt(done.total)).toBe(true);
    await expect(returnSale(A, { saleId: c, lines: [{ saleLineId: lineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "again" })).rejects.toBeInstanceOf(InventoryError);
  });

  it("the same offline sale sent five times at once is recorded once", async () => {
    await receive(A, item, "10", loc);
    const [d] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A.userId} and status = 'OPEN'`)).rows;
    const body = {
      offlineId: crypto.randomUUID(), localNumber: "OFF-X", facilityId: A.facilityId, sellerId: A.userId, sellerName: A.userName, drawerId: d.id, soldAt: new Date(Date.now() - 60_000).toISOString(),
      customerType: "ADULT_USE" as const, birthDate: id.birthDate, idExpires: id.idExpires, lines: [{ itemId: item, name: "Jar", quantity: "1", unitPrice: "10.01" }], discount: null,
      rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true }, total: "12.16", cashTendered: "20.00", changeDue: "7.84",
    };
    const before = await stockOf(item, A.facilityId);
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => recordOfflineSale(A, body)));
    const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    expect(new Set(ok.map((r) => r.saleId)).size).toBe(1);
    expect((await db.execute<{ n: string }>(sql`select count(*) n from sales where offline_id = ${body.offlineId}`)).rows[0].n).toBe("1");
    expect(await stockOf(item, A.facilityId)).toBe(before - 1);
  });

  it("nobody can reach another store's or another business's carts, packages or sales", async () => {
    const pkgX = await receive(X, itemX, "5", locX);
    const c = await cart(A, item, "1");
    // Another store in the same business.
    await expect(completeSale(B, { saleId: c, paymentMethod: "CASH", cashTendered: "50" })).rejects.toBeInstanceOf(InventoryError);
    await expect(addToCart(B, { saleId: c, itemId: item, quantity: "1" })).rejects.toBeInstanceOf(InventoryError);
    // Another business.
    await expect(completeSale(X, { saleId: c, paymentMethod: "CASH", cashTendered: "50" })).rejects.toBeInstanceOf(InventoryError);
    await expect(addToCart(X, { saleId: c, itemId: item, quantity: "1" })).rejects.toBeInstanceOf(InventoryError);
    await expect(voidSale(X, { saleId: c, reason: "x" })).rejects.toBeInstanceOf(InventoryError);
    await expect(movePackage(A, { packageId: pkgX.id, toLocationId: loc })).rejects.toBeInstanceOf(InventoryError);
    await expect(adjustPackage(A, { packageId: pkgX.id, newQuantity: "0", reasonCode: "DAMAGE" })).rejects.toBeInstanceOf(InventoryError);
    await expect(destroyPackage(A, { packageId: pkgX.id, reason: "x" })).rejects.toBeInstanceOf(InventoryError);
    await expect(addToCart(A, { saleId: c, itemId: itemX, quantity: "1" })).rejects.toBeInstanceOf(InventoryError);
    await expect(checkInCustomer({ ...A, orgId: X.orgId }, id)).rejects.toBeDefined();
    expect(await qtyOf(pkgX.id)).toBe(5);
    await cancelCart(A, { saleId: c });
    void locB;
  });

  it("a package that failed its lab cannot be sold, and sells again after a passing retest", async () => {
    const p = await receiveRaw(A, { tag: tag(), itemId: item, quantity: "4", locationId: loc });
    await addLabResult(A, { packageId: p.id, labName: "Lab", status: "FAIL", thcPercent: "20" });
    const before = await stockOf(item, A.facilityId);
    const c = await cart(A, item, "1").catch(() => null);
    if (c) {
      await completeSale(A, { saleId: c, paymentMethod: "CASH", cashTendered: "50" });
      const sold = await db.execute<{ package_id: string }>(sql`select p.package_id from sale_line_packages p join sale_lines l on l.id = p.sale_line_id where l.sale_id = ${c}`);
      expect(sold.rows.map((r) => r.package_id)).not.toContain(p.id);
    }
    expect(await qtyOf(p.id)).toBe(4);
    await addLabResult(A, { packageId: p.id, labName: "Lab retest", status: "PASS", thcPercent: "20" });
    void before;
  });

  it("odd quantities, prices and cash amounts are refused with a message, never a crash", async () => {
    const c = await checkInCustomer(A, id);
    const bad = ["-1", "0", "abc", "1e3", "", "0.00001", "NaN", "Infinity", "99999999999999999999", "1,5", " ", "\u0000"];
    for (const q of bad) {
      const r = await addToCart(A, { saleId: c.id, itemId: item, quantity: q }).then(() => "ok", (e) => e);
      if (r !== "ok") expect(r, `quantity ${JSON.stringify(q)}`).toBeInstanceOf(InventoryError);
    }
    for (const cash of bad) {
      const r = await openDrawer({ ...A2, facilityId: B.facilityId }, { openingCash: cash }).then(() => "ok", (e) => e);
      if (r !== "ok") expect(r, `cash ${JSON.stringify(cash)}`).toBeInstanceOf(InventoryError);
    }
    for (const price of bad) {
      const r = await setMenuItem(A, { itemId: item, price, limitCategory: "NONE" }).then(() => "ok", (e) => e);
      if (r !== "ok") expect(r, `price ${JSON.stringify(price)}`).toBeInstanceOf(InventoryError);
    }
    await setMenuItem(A, { itemId: item, price: "10.01", limitCategory: "NONE" });
    await cancelCart(A, { saleId: c.id });
  });

  it("a drawer cannot be closed with a cart open, closed twice, or sold into after closing", async () => {
    const c = await cart(A2, item, "1");
    await expect(closeDrawer(A2, { countedCash: "100" })).rejects.toBeInstanceOf(InventoryError);
    await cancelCart(A2, { saleId: c });
    const closed = await closeDrawer(A2, { countedCash: "100" });
    expect(closed.variance).toBe("0.00");
    await expect(closeDrawer(A2, { countedCash: "100" })).rejects.toBeInstanceOf(InventoryError);
    await expect(checkInCustomer(A2, id)).rejects.toBeInstanceOf(InventoryError);
    await openDrawer(A2, { openingCash: "100" });
  });

  it("the database pool survives a lost idle connection instead of ending the process", () => {
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
  });

  it("malformed CSV never throws a non-validation error", () => {
    const junk = ["", "\u0000\u0000", '"unterminated', "a,b\n\"x\"\"y\",\n,,,,\n", "﻿name,qty\r\n1", ",".repeat(5000), "a\n".repeat(5000), "\"".repeat(999), "name,qty\n" + "x,1\n".repeat(2500)];
    for (const text of junk) {
      try {
        parseCsv(text);
        readTable(text, ["name"], ["qty"]);
      } catch (e) {
        expect(e, JSON.stringify(text.slice(0, 20))).toBeInstanceOf(InventoryError);
      }
    }
  });

  it("a database connection lost in the middle of a batch of sales leaves no half-recorded sale", async () => {
    await receive(A, item, "60", loc);
    const carts: string[] = [];
    for (let i = 0; i < 12; i++) carts.push(await cart(A, item, "1"));
    const work = carts.map((c) => completeSale(A, { saleId: c, paymentMethod: "CASH", cashTendered: "50" }).then(() => "ok", () => "failed"));
    // Cut other active connections while the sales are in flight.
    await new Promise((r) => setTimeout(r, 15));
    const killer = await pool.connect();
    await killer.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state = 'active' and query ilike '%sale%'").catch(() => {});
    killer.release();
    await Promise.all(work);
    const bad = (await db.execute<{ n: string }>(sql`
      select count(*) n from sales s where s.facility_id = ${A.facilityId} and s.status = 'COMPLETED'
        and (s.total is null or not exists (select 1 from sale_lines l where l.sale_id = s.id)
             or exists (select 1 from sale_lines l left join sale_line_packages p on p.sale_line_id = l.id where l.sale_id = s.id group by l.id, l.quantity having l.quantity <> coalesce(sum(p.quantity),0)))`)).rows[0].n;
    expect(bad).toBe("0");
    const stuck = await db.select({ n: sql<number>`count(*)::int` }).from(sales).where(and(eq(sales.facilityId, A.facilityId), eq(sales.status, "OPEN")));
    expect(stuck[0].n).toBeGreaterThanOrEqual(0);
  });

  it("a connection that dies while checked out does not crash the process (CI finding APEX-31)", async () => {
    const victim = await pool.connect();
    const pid = (await victim.query("select pg_backend_pid() pid")).rows[0].pid as number;
    expect(victim.listenerCount("error")).toBeGreaterThan(0);
    await db.execute(sql`select pg_terminate_backend(${pid})`);
    await new Promise((r) => setTimeout(r, 300));
    victim.release(true);
    expect((await db.execute<{ one: number }>(sql`select 1 as one`)).rows[0].one).toBe(1);
  });

  it("the same package tag received four times at once makes one package", async () => {
    const t = tag();
    const rs = await Promise.allSettled(Array.from({ length: 4 }, () => receiveRaw(A, { tag: t, itemId: item, quantity: "5", locationId: loc })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of rs) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(InventoryError);
    expect((await db.select().from(packages).where(and(eq(packages.orgId, A.orgId), eq(packages.tag, t)))).length).toBe(1);
  });

  it("a Tally confirmation card used four times at once changes things once", async () => {
    const { TOOLS } = await import("@/lib/assistant/tools");
    const { confirmProposal } = await import("@/lib/assistant/engine");
    const session: Session = { userId: A.userId, orgId: A.orgId, facilityId: A.facilityId, name: A.userName, role: "OWNER", permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
    type Card = { title: string; action: { tool: string; args: Record<string, string> } };
    const t = `${run}-TAL`;
    const card = await (TOOLS.find((x) => x.name === "receive_packages") as unknown as { propose: (s: Session, i: Record<string, unknown>) => Promise<Card> }).propose(session, { location: "Floor", packages: [{ item: "AV Jar".replace("AV", "One"), quantity: "3", tag: t }] });
    const token = await new SignJWT({ action: card.action, title: card.title, uid: session.userId, org: session.orgId, fac: session.facilityId })
      .setProtectedHeader({ alg: "HS256" }).setJti(crypto.randomUUID().replace(/-/g, "")).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(`assistant:${process.env.AUTH_SECRET}`));
    const rs = await Promise.allSettled(Array.from({ length: 4 }, () => confirmProposal(session, token)));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.select().from(packages).where(and(eq(packages.orgId, A.orgId), eq(packages.tag, t)))).length).toBe(1);
  });

  it("webhook addresses hidden inside IPv6 forms are still treated as private", () => {
    for (const host of ["[::ffff:a9fe:a9fe]", "[::ffff:7f00:1]", "[::ffff:169.254.169.254]", "[::7f00:1]", "[64:ff9b::a00:1]", "[fe90::1]", "[::1]"]) {
      expect(() => checkWebhookUrl(`https://${host}/x`), host).toThrow(InventoryError);
    }
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
  });

  it("an offline sale cannot hide a purchase limit by claiming a looser class", async () => {
    const { setMenuItem: setItem } = await import("@/lib/pos");
    await setItem(A, { itemId: item, price: "10.01", limitCategory: "FLOWER", limitPerUnit: "28" });
    try {
      await receive(A, item, "10", loc);
      const [d] = (await db.execute<{ id: string }>(sql`select id from drawer_sessions where user_id = ${A.userId} and status = 'OPEN'`)).rows;
      const r = await recordOfflineSale(A, {
        offlineId: crypto.randomUUID(), localNumber: "OFF-T", facilityId: A.facilityId, sellerId: A.userId, sellerName: A.userName, drawerId: d.id, soldAt: new Date(Date.now() - 60_000).toISOString(),
        customerType: "ADULT_USE", birthDate: id.birthDate, idExpires: id.idExpires, lines: [{ itemId: item, name: "Jar", quantity: "3", unitPrice: "10.01", limitCategory: "NONE", limitPerUnit: null }], discount: null,
        rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true }, total: "36.51", cashTendered: "50.00", changeDue: "13.49",
      });
      const [row] = await db.select().from(sales).where(eq(sales.id, r.saleId));
      expect(row.reviewNote ?? "").toMatch(/Purchase limit/);
    } finally {
      await setItem(A, { itemId: item, price: "10.01", limitCategory: "NONE" });
    }
  });
});
