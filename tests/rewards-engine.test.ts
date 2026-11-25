import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, itemCategories, items, locations, organizations, rewardLedger, rewardMembers, sales, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import {
  addToCart,
  attachRewardsMember,
  checkInCustomer,
  completeSale,
  detachRewardsMember,
  joinRewards,
  openDrawer,
  removeFromCart,
  returnableLines,
  returnSale,
  saveRetailSettings,
  setMenuItem,
  setRewardsUsed,
  voidSale,
} from "@/lib/pos";
import { adjustPoints, deleteMember, getProgram, saveProgram } from "@/lib/rewards";

/**
 * The rewards program through the real register: sign up at the counter, earn on what's paid before tax,
 * spend as dollars off (never more than the cart's cap, so no cannabis is ever free), and points undone by
 * voids and returns.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const run = `RW${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const adult = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };
const thisMonth = `${today.slice(5, 7)}-15`;
const otherMonth = `${String(((Number(today.slice(5, 7)) + 5) % 12) + 1).padStart(2, "0")}-15`;

let actor: Actor;
let jar: string;
let papers: string;
let shelf: string;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;
const member = async (phone: string) => (await db.select().from(rewardMembers).where(and(eq(rewardMembers.orgId, actor.orgId), eq(rewardMembers.phone, phone))))[0];
const sale = async (id: string) => (await db.select().from(sales).where(eq(sales.id, id)))[0];

async function cart(itemsWanted: [string, string][]) {
  const s = await checkInCustomer(actor, adult);
  for (const [itemId, quantity] of itemsWanted) await addToCart(actor, { saleId: s.id, itemId, quantity });
  return s.id;
}
const pay = (saleId: string) => completeSale(actor, { saleId, paymentMethod: "DEBIT" });

describe.skipIf(!hasDb)("rewards program (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Rewards Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Bud Tender", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db
      .insert(items)
      .values(["Jar 3.5", "Papers"].map((name, i) => ({ orgId: org.id, name, sku: `${run}${i}`, categoryId: category.id, unit: "EACH" as const })))
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    shelf = location.id;
    [jar, papers] = made.map((i) => i.id);
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "8", medicalTaxExempt: true });
    await setMenuItem(actor, { itemId: jar, price: "40", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await setMenuItem(actor, { itemId: papers, price: "2", limitCategory: "NONE" });
    for (const itemId of [jar, papers]) {
      const pkg = await receiveRaw(actor, { tag: tag(), itemId, quantity: "100", locationId: shelf });
      await addLabResult(actor, { packageId: pkg.id, labName: "Test Lab", status: "PASS", thcPercent: "20" });
    }
    await openDrawer(actor, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("starts off, with the industry-standard numbers ready", async () => {
    const program = await getProgram(db, actor.orgId);
    expect(program).toMatchObject({ enabled: false, pointsPerDollar: 1, redeemPoints: 100, redeemDollars: "5.00", signupBonus: 25, birthdayBonus: 50, maxSharePercent: 50 });
    const s = await cart([[jar, "1"]]);
    await expect(attachRewardsMember(actor, { saleId: s, phone: "5055550101" })).rejects.toThrow(/rewards program is off/);
    await saveProgram(actor, { enabled: "on", pointsPerDollar: "1", redeemPoints: "100", redeemDollars: "5", signupBonus: "25", birthdayBonus: "50", expireMonths: "12", maxSharePercent: "50" });
    expect(await attachRewardsMember(actor, { saleId: s, phone: "(505) 555-0101" })).toBeNull();
  });

  it("signs a shopper up at the counter only when they agree, and earns on what they paid before tax", async () => {
    const s = await cart([[jar, "2"]]);
    await expect(joinRewards(actor, { saleId: s, phone: "505-555-0102", firstName: "Dana", birthday: otherMonth, agreed: false })).rejects.toThrow(/agreed/);
    await expect(joinRewards(actor, { saleId: s, phone: "555-0102", firstName: "Dana", agreed: "on" })).rejects.toThrow(/10-digit/);
    const joined = await joinRewards(actor, { saleId: s, phone: "505-555-0102", firstName: "Dana", birthday: otherMonth, agreed: "on" });
    expect(joined).toEqual({ firstName: "Dana", points: 25 });
    await expect(joinRewards(actor, { saleId: s, phone: "5055550102", firstName: "Again", agreed: "on" })).rejects.toThrow(/already in the rewards program/);
    await pay(s);
    // $80 before tax: 80 points, plus the 25 welcome points.
    expect((await sale(s)).pointsEarned).toBe(80);
    expect((await member("5055550102")).points).toBe(105);
    // Nothing that names the shopper goes in the audit trail.
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.orgId, actor.orgId));
    expect(JSON.stringify(trail)).not.toMatch(/Dana|5055550102/);
  });

  it("will not let reward points pay for an item the store takes back (APEX-40)", async () => {
    await db.update(items).set({ returnable: true }).where(eq(items.id, jar));
    try {
      const s = await cart([[jar, "1"]]);
      await attachRewardsMember(actor, { saleId: s, phone: "5055550102" });
      await expect(setRewardsUsed(actor, { saleId: s, count: 1 })).rejects.toThrow(/can be returned/);
      await detachRewardsMember(actor, { saleId: s });
    } finally {
      await db.update(items).set({ returnable: false }).where(eq(items.id, jar));
    }
  });

  it("spends rewards as dollars off before tax, and never lets a reward pay for most of a cart", async () => {
    const small = await cart([[papers, "4"]]); // $8: a $5 reward would be 62% of it
    expect(await attachRewardsMember(actor, { saleId: small, phone: "5055550102" })).toEqual({ firstName: "Dana", points: 105 });
    await expect(setRewardsUsed(actor, { saleId: small, count: 1 })).rejects.toThrow(/at most 50%.*free cannabis/);
    await expect(setRewardsUsed(actor, { saleId: small, count: 2 })).rejects.toThrow(/enough for 1 reward/);
    await detachRewardsMember(actor, { saleId: small });

    const big = await cart([[jar, "1"]]); // $40
    await attachRewardsMember(actor, { saleId: big, phone: "5055550102" });
    await setRewardsUsed(actor, { saleId: big, count: 1 });
    const paid = await pay(big);
    // $40 - $5 = $35, then 12% + 8% tax = $42.00
    expect(paid.total).toBe("42.00");
    const row = await sale(big);
    expect([row.rewardsUsed, row.rewardDiscount, row.discountTotal, row.pointsEarned]).toEqual([1, "5.00", "5.00", 35]);
    expect((await member("5055550102")).points).toBe(105 - 100 + 35);
  });

  it("uses fewer rewards when the cart shrinks after they were chosen", async () => {
    const m = await member("5055550102");
    await adjustPoints(actor, { memberId: m.id, points: "300", reason: "Make-good for a mix-up" });
    const s = await cart([[jar, "1"]]); // $40: room for 4 rewards ($20)
    await attachRewardsMember(actor, { saleId: s, phone: "5055550102" });
    await setRewardsUsed(actor, { saleId: s, count: 3 });
    // Swap the jar for papers worth $20: only 2 rewards ($10) fit now.
    await addToCart(actor, { saleId: s, itemId: papers, quantity: "10" });
    const [line] = (await db.execute<{ id: string }>(sql`select id from sale_lines where sale_id = ${s} and item_id = ${jar}`)).rows;
    await removeFromCart(actor, { lineId: line.id });
    await pay(s);
    expect((await sale(s)).rewardsUsed).toBe(2);
  });

  it("gives the birthday bonus once a year in the birthday month", async () => {
    const s = await cart([[jar, "1"]]);
    await joinRewards(actor, { saleId: s, phone: "5055550103", firstName: "Bea", birthday: thisMonth, agreed: "on" });
    await pay(s);
    expect((await member("5055550103")).points).toBe(25 + 40 + 50);
    const again = await cart([[jar, "1"]]);
    await attachRewardsMember(actor, { saleId: again, phone: "5055550103" });
    await pay(again);
    expect((await member("5055550103")).points).toBe(25 + 40 + 50 + 40);
  });

  it("undoes points on a void, and takes back points for returned items", async () => {
    const s = await cart([[jar, "1"]]);
    await attachRewardsMember(actor, { saleId: s, phone: "5055550103" });
    await setRewardsUsed(actor, { saleId: s, count: 1 });
    const before = (await member("5055550103")).points;
    await pay(s);
    expect((await member("5055550103")).points).toBe(before - 100 + 35);
    await voidSale(actor, { saleId: s, reason: "Rang up wrong" });
    expect((await member("5055550103")).points).toBe(before);

    const r = await cart([[jar, "2"]]);
    await attachRewardsMember(actor, { saleId: r, phone: "5055550103" });
    await pay(r);
    expect((await member("5055550103")).points).toBe(before + 80);
    const [line] = await returnableLines(db, r);
    await returnSale(actor, { saleId: r, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CARD", disposition: "RESTOCK", reason: "changed mind" });
    expect((await member("5055550103")).points).toBe(before + 40);
    await returnSale(actor, { saleId: r, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CARD", disposition: "RESTOCK", reason: "changed mind" });
    expect((await member("5055550103")).points).toBe(before);
  });

  it("lets a manager correct points with a reason, and delete a shopper who asks while keeping the sales", async () => {
    const m = await member("5055550103");
    await expect(adjustPoints(actor, { memberId: m.id, points: "50", reason: " " })).rejects.toThrow(/Say why/);
    await expect(adjustPoints(actor, { memberId: m.id, points: String(-(m.points + 1)), reason: "oops" })).rejects.toThrow(/at most/);
    const salesBefore = await db.select().from(sales).where(eq(sales.rewardMemberId, m.id));
    expect(salesBefore.length).toBeGreaterThan(0);
    expect(await deleteMember(actor, { memberId: m.id })).toBe("Bea");
    expect(await member("5055550103")).toBeUndefined();
    expect(await db.select().from(rewardLedger).where(eq(rewardLedger.memberId, m.id))).toHaveLength(0);
    for (const s of salesBefore) {
      const after = await sale(s.id);
      expect(after.rewardMemberId).toBeNull();
      expect(new Decimal(after.total ?? 0).eq(s.total ?? 0)).toBe(true);
    }
  });
});
