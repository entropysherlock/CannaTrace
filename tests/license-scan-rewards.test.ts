import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, itemCategories, organizations, rewardMembers, sales, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { type Actor } from "@/lib/inventory";
import { attachRewardsMember, checkInCustomer, detachRewardsMember, joinRewards, linkIdToRewardsMember, openDrawer, saveRetailSettings } from "@/lib/pos";
import { saveProgram } from "@/lib/rewards";

/** Scanning a driver's license finds the shopper's rewards account, but only when the business turned that on and the shopper agreed. */
const hasDb = Boolean(process.env.DATABASE_URL);
const run = `LS${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const scan = (idNumber: string) => ({ birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE", idNumber });
const program = (idLookup: boolean) =>
  saveProgram(actor, { enabled: "on", pointsPerDollar: "1", redeemPoints: "100", redeemDollars: "5", signupBonus: "25", birthdayBonus: "50", expireMonths: "12", maxSharePercent: "50", ...(idLookup ? { idLookup: "on" } : {}) });

let actor: Actor;
const sale = async (id: string) => (await db.select().from(sales).where(eq(sales.id, id)))[0];
const byPhone = async (phone: string) => (await db.select().from(rewardMembers).where(and(eq(rewardMembers.orgId, actor.orgId), eq(rewardMembers.phone, phone))))[0];

describe.skipIf(!hasDb)("license scan finds rewards (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Scan Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Bud Tender", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    await db.insert(itemCategories).values({ orgId: org.id, name: "All" });
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "8", medicalTaxExempt: true });
    await openDrawer(actor, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("does nothing while the setting is off, even for a shopper who has an account", async () => {
    await program(false);
    const first = await checkInCustomer(actor, scan("NM-ALPHA-1001"));
    await joinRewards(actor, { saleId: first.id, phone: "505-555-0201", firstName: "Ana", agreed: "on" });
    expect((await byPhone("5055550201")).idKey).toBeNull();
    const again = await checkInCustomer(actor, scan("NM-ALPHA-1001"));
    expect((await sale(again.id)).rewardMemberId).toBeNull();
  });

  it("links the ID at sign-up when on, and the next scan puts their account on the cart", async () => {
    await program(true);
    const first = await checkInCustomer(actor, scan("NM-BRAVO-2002"));
    expect((await sale(first.id)).rewardMemberId).toBeNull();
    await joinRewards(actor, { saleId: first.id, phone: "505-555-0202", firstName: "Ben", agreed: "on" });
    const ben = await byPhone("5055550202");
    expect(ben.idKey).toMatch(/^[0-9a-f]{64}$/);
    expect(ben.idKey).not.toContain("BRAVO");
    const next = await checkInCustomer(actor, scan("nm bravo-2002"));
    expect((await sale(next.id)).rewardMemberId).toBe(ben.id);
    const stranger = await checkInCustomer(actor, scan("NM-CHARLIE-3003"));
    expect((await sale(stranger.id)).rewardMemberId).toBeNull();
  });

  it("links an existing phone account only on request, once, and never to two accounts", async () => {
    const s = await checkInCustomer(actor, scan("NM-DELTA-4004"));
    await expect(linkIdToRewardsMember(actor, { saleId: s.id })).rejects.toThrow(/rewards account to the cart first/);
    await joinRewards(actor, { saleId: s.id, phone: "505-555-0203", firstName: "Cy", agreed: "on" });
    await db.update(rewardMembers).set({ idKey: null }).where(eq(rewardMembers.id, (await byPhone("5055550203")).id));
    await linkIdToRewardsMember(actor, { saleId: s.id });
    const cy = await byPhone("5055550203");
    expect(cy.idKey).not.toBeNull();
    await expect(linkIdToRewardsMember(actor, { saleId: s.id })).rejects.toThrow(/already linked/);
    // A different account can't take over the same ID.
    const other = await checkInCustomer(actor, scan("NM-DELTA-4004"));
    await detachRewardsMember(actor, { saleId: other.id });
    await joinRewards(actor, { saleId: other.id, phone: "505-555-0204", firstName: "Di", agreed: "on" });
    expect((await byPhone("5055550204")).idKey).toBeNull();
  });

  it("refuses to link when the cart has no ID scan or the setting is off", async () => {
    const s = await checkInCustomer(actor, scan("NM-ECHO-5005"));
    await attachRewardsMember(actor, { saleId: s.id, phone: "5055550203" });
    await program(false);
    await expect(linkIdToRewardsMember(actor, { saleId: s.id })).rejects.toThrow(/ID scan is off/);
  });

  it("keeps the ID number out of the audit trail and the database", async () => {
    const trail = JSON.stringify(await db.select().from(auditLogs).where(eq(auditLogs.orgId, actor.orgId)));
    expect(trail).not.toMatch(/ALPHA|BRAVO|CHARLIE|DELTA|ECHO/i);
    const members = JSON.stringify(await db.select().from(rewardMembers).where(eq(rewardMembers.orgId, actor.orgId)));
    expect(members).not.toMatch(/ALPHA|BRAVO|CHARLIE|DELTA|ECHO/i);
  });
});
