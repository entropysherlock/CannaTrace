import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packages, saleLinePackages, saleLines, sales, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { markReviewed, recordOfflineSale, reviewCount, reviewQueue } from "@/lib/offline-sales";
import { buildOfflineSnapshot } from "@/lib/offline-snapshot";
import type { OfflineSale } from "@/lib/offline-types";
import { closeDrawer, openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `OS${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
let actor: Actor;
let jar: string;
let papers: string;
let drawerId: string;
let n = 0;

const qty = async (itemId: string) => (await db.select().from(packages).where(eq(packages.itemId, itemId))).reduce((s, p) => s.add(p.quantity), new Decimal(0)).toString();
const base = (over: Partial<OfflineSale> = {}): OfflineSale => ({
  offlineId: crypto.randomUUID(),
  localNumber: `OFF-${++n}`,
  facilityId: actor.facilityId,
  sellerId: actor.userId,
  sellerName: actor.userName,
  drawerId,
  soldAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  customerType: "ADULT_USE",
  birthDate: "1990-05-05",
  idExpires: addDays(today, 400),
  // 2 papers at $2 = $4.00; 14% excise 0.56, 7.625% sales tax 0.31 => 4.87
  lines: [{ itemId: papers, name: "Papers", quantity: "2", unitPrice: "2.00" }],
  discount: null,
  total: "4.87",
  cashTendered: "10.00",
  changeDue: "5.13",
  ...over,
});

describe.skipIf(!hasDb)("offline sales (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Offline Org ${run}` }).returning();
    const [facility, other] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "Offline Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" },
        { orgId: org.id, name: "Other Shop", licenseNumber: `${run}-B`, licenseType: "RETAIL", state: "NM" },
      ])
      .returning();
    void other;
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Bud Tender", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db
      .insert(items)
      .values(["Jar 3.5", "Papers"].map((name, i) => ({ orgId: org.id, name, sku: `${run}-${i}`, categoryId: category.id, unit: "EACH" as const })))
      .returning();
    [jar, papers] = made.map((i) => i.id);
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    await setMenuItem(actor, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await setMenuItem(actor, { itemId: papers, price: "2", limitCategory: "NONE" });
    for (const [itemId, quantity] of [[jar, "30"], [papers, "10"]]) {
      const pkg = await receiveRaw(actor, { tag: `${run}-${itemId.slice(0, 4)}`, itemId, quantity, locationId: location.id });
      await addLabResult(actor, { packageId: pkg.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    }
    drawerId = (await openDrawer(actor, { openingCash: "100" })).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("saves a copy of what the register needs, worked out like the register does", async () => {
    const snap = await buildOfflineSnapshot(actor);
    expect(snap?.facilityName).toBe("Offline Shop");
    expect(snap?.drawerId).toBe(drawerId);
    expect(snap?.settings).toMatchObject({ exciseTaxPercent: "14", salesTaxPercent: "7.625", adultMinAge: 21 });
    expect(snap?.limits.ADULT_USE.FLOWER).toBe("56.7");
    expect(snap?.menu.map((m) => m.name).sort()).toEqual(["Jar 3.5", "Papers"]);
    expect(snap?.menu.find((m) => m.name === "Papers")).toMatchObject({ price: "2.00", stock: "10", unitLabel: expect.any(String) });
    // A store with no rules has nothing to sell offline.
    const [bare] = await db.insert(facilities).values({ orgId: actor.orgId, name: "No Rules", licenseNumber: `${run}-C`, licenseType: "RETAIL", state: "NM" }).returning();
    expect(await buildOfflineSnapshot({ ...actor, facilityId: bare.id })).toBeNull();
  });

  it("records a clean cash sale: stock taken, totals right, no review needed", async () => {
    const before = await qty(papers);
    const soldAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const r = await recordOfflineSale(actor, base({ soldAt }));
    expect(r).toMatchObject({ flagged: false, duplicate: false });
    expect(r.number).toMatch(/^S-\d{5}$/);
    expect(new Decimal(before).sub(await qty(papers)).toString()).toBe("2");
    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId));
    expect(s).toMatchObject({ status: "COMPLETED", paymentMethod: "CASH", total: "4.87", changeDue: "5.13", drawerSessionId: drawerId, reviewNote: null });
    expect(s.completedAt?.toISOString()).toBe(soldAt);
    expect(await db.select().from(saleLinePackages).innerJoin(saleLines, eq(saleLines.id, saleLinePackages.saleLineId)).where(eq(saleLines.saleId, r.saleId))).toHaveLength(1);
  });

  it("never records the same sale twice, however many times it is sent", async () => {
    const sale = base();
    const before = await qty(papers);
    const a = await recordOfflineSale(actor, sale);
    const b = await recordOfflineSale(actor, sale);
    expect(b).toMatchObject({ saleId: a.saleId, number: a.number, duplicate: true });
    expect(new Decimal(before).sub(await qty(papers)).toString()).toBe("2");
  });

  it("records a sale it cannot fully verify, and writes down what to check", async () => {
    // Price changed since the device saved its copy; ID that does not pass today; over the limit; wrong receipt total.
    const under = `${Number(today.slice(0, 4)) - 20}${today.slice(4)}`;
    const r = await recordOfflineSale(
      actor,
      base({
        birthDate: under,
        lines: [
          { itemId: papers, name: "Papers", quantity: "1", unitPrice: "1.50" },
          { itemId: jar, name: "Jar 3.5", quantity: "17", unitPrice: "35.00" },
        ],
        total: "100.00",
        cashTendered: "1000.00",
        discount: { name: "Friends and family", percent: "15" },
      }),
    );
    expect(r.flagged).toBe(true);
    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId));
    expect(s.status).toBe("COMPLETED"); // it already happened: recorded, not refused
    const note = s.reviewNote ?? "";
    expect(note).toMatch(/Papers was sold at \$1.50; the menu price now is \$2.00/);
    expect(note).toMatch(/ID check: .*minimum age is 21/);
    expect(note).toMatch(/Purchase limit: .*59.5 g/);
    expect(note).toMatch(/not on the current discount list/);
    expect(note).toMatch(/receipt showed \$100.00/);
  });

  it("keeps what stock it can find when the shelf turns out to be short, and flags it", async () => {
    const before = await qty(papers);
    const r = await recordOfflineSale(actor, base({ lines: [{ itemId: papers, name: "Papers", quantity: "500", unitPrice: "2.00" }], total: "1140.00", cashTendered: "1200.00" }));
    expect(r.flagged).toBe(true);
    expect(await qty(papers)).toBe("0");
    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId));
    expect(s.reviewNote).toMatch(/Not enough stock: Papers was short by 4\d\d/);
    expect(new Decimal(before).gt(0)).toBe(true);
    // Put some back for later tests.
    const [pkg] = await db.select().from(packages).where(eq(packages.itemId, papers));
    await db.update(packages).set({ quantity: "100" }).where(eq(packages.id, pkg.id));
  });

  it("turns away only what is truly unusable, so the register keeps it to try again", async () => {
    const reject = (over: Partial<OfflineSale>, message: RegExp) => expect(recordOfflineSale(actor, base(over))).rejects.toThrow(message);
    await reject({ offlineId: "not-a-uuid" }, /no valid id/);
    await reject({ facilityId: "someone-else" }, /different store/);
    await reject({ soldAt: new Date(Date.now() + 3_600_000).toISOString() }, /future/);
    await reject({ soldAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }, /more than 14 days old/);
    await reject({ soldAt: "yesterday" }, /no valid time/);
    await reject({ lines: [] }, /no items/);
    await reject({ lines: [{ itemId: papers, name: "P", quantity: "-1", unitPrice: "2" }] }, /impossible quantity/);
    await reject({ lines: [{ itemId: "missing-item", name: "P", quantity: "1", unitPrice: "2" }] }, /does not exist/);
    await reject({ lines: [{ itemId: papers, name: "P", quantity: "1", unitPrice: "abc" }] }, /not a number/);
    await reject({ discount: { name: "x", percent: "400" } }, /impossible discount/);
    await reject({ customerType: "OTHER" as never }, /customer type/);
  });

  it("will not sync into a store with no open drawer, and records nothing", async () => {
    const closed = { ...actor, userId: actor.userId };
    await closeDrawer(closed, { countedCash: "300" });
    const sale = base({ drawerId: null });
    await expect(recordOfflineSale(actor, sale)).rejects.toThrow(/Open your cash drawer/);
    expect(await db.select().from(sales).where(eq(sales.offlineId, sale.offlineId))).toHaveLength(0);
    // Once a drawer is open again it goes in. The drawer it was rung up on is closed, so that is noted.
    await openDrawer(actor, { openingCash: "100" });
    const r = await recordOfflineSale(actor, { ...sale, drawerId });
    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId));
    // APEX-14: the cash was taken at the drawer the sale was rung up on, so it stays attributed there.
    expect(s.drawerSessionId).toBe(drawerId);
    expect(s.reviewNote).toMatch(/drawer it was rung up on was already closed/);
  });

  it("lists flagged sales for a manager, who can mark them reviewed once", async () => {
    const queue = await reviewQueue(actor);
    expect(queue.length).toBeGreaterThanOrEqual(3);
    const waiting = await reviewCount(actor.facilityId);
    expect(waiting).toBe(queue.filter((q) => !q.reviewedAt).length);
    const first = queue.find((q) => !q.reviewedAt)!;
    await markReviewed(actor, { saleId: first.id, note: "Counted the shelf, fixed." });
    expect(await reviewCount(actor.facilityId)).toBe(waiting - 1);
    await expect(markReviewed(actor, { saleId: first.id })).rejects.toThrow(/already reviewed/);
    const clean = (await db.select().from(sales).where(eq(sales.facilityId, actor.facilityId))).find((s) => s.offlineId && s.reviewNote === null)!;
    await expect(markReviewed(actor, { saleId: clean.id })).rejects.toThrow(/nothing to review/);
  });
});
