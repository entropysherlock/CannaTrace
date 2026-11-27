import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { campaignMessages, facilities, itemCategories, items, locations, marketingAutomations, memberConsents, organizations, rewardMembers, sales, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { cardByToken, cardConsent, deleteBoost, deleteTier, listShoppers, saveBoost, saveMarketingSettings, saveTier, setShopperConsent, shopperProfile, updateShopperProfile } from "@/lib/loyalty";
import { currentConsents } from "@/lib/loyalty-earn";
import { campaignResults, createCampaign, getCampaign, previewCampaign, runAutomations, saveAutomation, sendCampaign } from "@/lib/marketing";
import { stopTexting } from "@/lib/marketing-inbound";
import { addToCart, checkInCustomer, completeSale, joinRewards, attachRewardsMember, openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";
import { saveProgram } from "@/lib/rewards";

/** The CRM and loyalty extras through the real register: tiers, bonus days, referrals, what shoppers agreed to, and messages that follow the rules. */
const hasDb = Boolean(process.env.DATABASE_URL);
const run = `LY${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const adult = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };

let actor: Actor;
let jar: string;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;
const member = async (phone: string) => (await db.select().from(rewardMembers).where(and(eq(rewardMembers.orgId, actor.orgId), eq(rewardMembers.phone, phone))))[0];
const sale = async (id: string) => (await db.select().from(sales).where(eq(sales.id, id)))[0];

/** Ring up one $40 jar for the shopper with this phone. Returns the points that sale earned. */
async function buy(phone: string): Promise<number> {
  const s = await checkInCustomer(actor, adult);
  await addToCart(actor, { saleId: s.id, itemId: jar, quantity: "1" });
  await attachRewardsMember(actor, { saleId: s.id, phone });
  await completeSale(actor, { saleId: s.id, paymentMethod: "DEBIT" });
  return (await sale(s.id)).pointsEarned;
}
async function signUp(phone: string, name: string, extra: Record<string, unknown> = {}) {
  const s = await checkInCustomer(actor, adult);
  await joinRewards(actor, { saleId: s.id, phone, firstName: name, agreed: true, ...extra });
  return member(phone);
}
const sentTo = async (memberId: string) => db.select().from(campaignMessages).where(eq(campaignMessages.memberId, memberId));

describe.skipIf(!hasDb)("loyalty and CRM (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Loyalty Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Manager", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const [item] = await db.insert(items).values({ orgId: org.id, name: "Jar 3.5", sku: `${run}J`, categoryId: category.id, unit: "EACH" }).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    jar = item.id;
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "8", medicalTaxExempt: true });
    await setMenuItem(actor, { itemId: jar, price: "40", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    const pkg = await receiveRaw(actor, { tag: tag(), itemId: jar, quantity: "500", locationId: location.id });
    await addLabResult(actor, { packageId: pkg.id, labName: "Test Lab", status: "PASS", thcPercent: "20" });
    await openDrawer(actor, { openingCash: "100" });
    await saveProgram(actor, { enabled: "on", pointsPerDollar: "1", redeemPoints: "100", redeemDollars: "5", signupBonus: "0", birthdayBonus: "0", expireMonths: "0", maxSharePercent: "50" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  });
  afterAll(() => pool.end());

  it("records what a shopper agreed to, with the words they saw, and rejects bad sign-ups", async () => {
    const ana = await signUp("5055550301", "Ana", { email: "Ana@Example.com", emailOk: true, smsOk: true });
    expect(ana.email).toBe("ana@example.com");
    expect(ana.referralCode).toMatch(/^[2-9A-Z]{6}$/);
    expect(ana.cardToken).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    const log = await db.select().from(memberConsents).where(eq(memberConsents.memberId, ana.id));
    expect(log.map((c) => `${c.channel}:${c.status}:${c.method}`).sort()).toEqual(["EMAIL:OPTED_IN:REGISTER", "SMS:OPTED_IN:REGISTER"]);
    expect(log.find((c) => c.channel === "SMS")!.wording).toMatch(/STOP/);
    expect((await currentConsents(db, actor.orgId, [ana.id])).get(ana.id)).toEqual({ EMAIL: true, SMS: true });

    const s = await checkInCustomer(actor, adult);
    await expect(joinRewards(actor, { saleId: s.id, phone: "5055550302", firstName: "Bo", agreed: true, emailOk: true })).rejects.toThrow(/email/i);
    await expect(joinRewards(actor, { saleId: s.id, phone: "5055550302", firstName: "Bo", agreed: true, email: "nope" })).rejects.toThrow(/email/i);
    await expect(joinRewards(actor, { saleId: s.id, phone: "5055550302", firstName: "Bo", agreed: true, referralCode: "ZZZZZZ" })).rejects.toThrow(/referral code/);
    expect(await member("5055550302")).toBeUndefined();
  });

  it("keeps consent history append-only, and a shopper can leave from their own card", async () => {
    const ana = await member("5055550301");
    await setShopperConsent(actor, { memberId: ana.id, channel: "SMS", agreed: false });
    expect((await currentConsents(db, actor.orgId, [ana.id])).get(ana.id)).toEqual({ EMAIL: true, SMS: false });
    expect(await cardConsent(ana.cardToken!, { channel: "EMAIL", agreed: false, method: "UNSUBSCRIBE" })).toBe(true);
    expect((await currentConsents(db, actor.orgId, [ana.id])).get(ana.id)).toEqual({ EMAIL: false, SMS: false });
    const log = await db.select().from(memberConsents).where(eq(memberConsents.memberId, ana.id));
    expect(log).toHaveLength(4);
    expect(log.some((c) => c.method === "UNSUBSCRIBE" && c.status === "OPTED_OUT")).toBe(true);
    expect(await cardConsent("not-a-token-at-all-not-a-token", { channel: "EMAIL", agreed: false, method: "CARD" })).toBe(false);
    expect(await cardByToken("short")).toBeNull();
    // Opting in to email needs an address on file.
    const noEmail = await signUp("5055550303", "Cy");
    await expect(setShopperConsent(actor, { memberId: noEmail.id, channel: "EMAIL", agreed: true })).rejects.toThrow(/email/i);
    await setShopperConsent(actor, { memberId: ana.id, channel: "EMAIL", agreed: true });
    await setShopperConsent(actor, { memberId: ana.id, channel: "SMS", agreed: true });
  });

  it("a STOP text ends texting for that number and leaves a record", async () => {
    const ana = await member("5055550301");
    expect(await stopTexting("5055550301")).toBeGreaterThanOrEqual(1);
    expect((await currentConsents(db, actor.orgId, [ana.id])).get(ana.id)).toEqual({ EMAIL: true, SMS: false });
    const last = (await db.select().from(memberConsents).where(and(eq(memberConsents.memberId, ana.id), eq(memberConsents.channel, "SMS"))).orderBy(sql`created_at desc, id desc`))[0];
    expect(last).toMatchObject({ status: "OPTED_OUT", method: "STOP_REPLY" });
    expect(await stopTexting("5055550301")).toBe(0);
    await setShopperConsent(actor, { memberId: ana.id, channel: "SMS", agreed: true });
  });

  it("pays a referral bonus once, on the new shopper's first purchase", async () => {
    const ana = await member("5055550301");
    const dev = await signUp("5055550304", "Dev", { referralCode: ana.referralCode!.toLowerCase() });
    expect(dev.referredById).toBe(ana.id);
    const before = (await member("5055550301")).points;
    expect(await buy("5055550304")).toBe(40);
    expect((await member("5055550301")).points).toBe(before + 50);
    await buy("5055550304");
    expect((await member("5055550301")).points).toBe(before + 50);
    const profile = await shopperProfile(actor.orgId, ana.id);
    expect(profile!.referralsMade).toBe(1);
    const devProfile = await shopperProfile(actor.orgId, dev.id);
    expect(devProfile!.referredBy).toBe("Ana");
  });

  it("earns faster in a higher tier and on bonus days, and shows the speed in the history", async () => {
    await signUp("5055550305", "Eve");
    expect(await buy("5055550305")).toBe(40);
    await saveTier(actor, { name: "Everyone", minSpend: "0", earnPercent: "150", perk: "More points" });
    expect(await buy("5055550305")).toBe(60);
    await saveBoost(actor, { name: "Double weekend", startDate: today, endDate: today, earnPercent: "200" });
    expect(await buy("5055550305")).toBe(120);
    const [boost] = (await db.execute<{ id: string }>(sql`select id from reward_boosts where org_id = ${actor.orgId}`)).rows;
    await deleteBoost(actor, { boostId: boost.id });
    expect(await buy("5055550305")).toBe(60);
    const [tier] = (await db.execute<{ id: string }>(sql`select id from reward_tiers where org_id = ${actor.orgId}`)).rows;
    await deleteTier(actor, { tierId: tier.id });
    expect(await buy("5055550305")).toBe(40);
    const profile = await shopperProfile(actor.orgId, (await member("5055550305")).id);
    expect(profile!.history.some((h) => /speed/.test(h.note ?? ""))).toBe(true);
  });

  it("groups shoppers by how recently they bought, and finds them by search", async () => {
    const eve = await member("5055550305");
    let list = await listShoppers(actor.orgId, { q: "eve" });
    expect(list.rows[0]).toMatchObject({ firstName: "Eve", segment: "REGULAR" });
    await db.update(sales).set({ completedAt: sql`now() - interval '60 days'` }).where(eq(sales.rewardMemberId, eve.id));
    list = await listShoppers(actor.orgId, { segment: "AT_RISK" });
    expect(list.rows.map((r) => r.firstName)).toContain("Eve");
    await db.update(sales).set({ completedAt: sql`now() - interval '120 days'` }).where(eq(sales.rewardMemberId, eve.id));
    list = await listShoppers(actor.orgId, { segment: "LAPSED" });
    expect(list.rows.map((r) => r.firstName)).toContain("Eve");
    await db.update(sales).set({ completedAt: sql`now() - interval '3 days'` }).where(eq(sales.rewardMemberId, eve.id));
    expect((await listShoppers(actor.orgId, { q: "5055550305" })).matching).toBe(1);
  });

  it("keeps profile edits, tags and notes, and never puts them in the audit trail", async () => {
    const eve = await member("5055550305");
    await updateShopperProfile(actor, { memberId: eve.id, email: "eve@example.com", tags: "VIP, Edibles, vip", notes: "Prefers mornings" });
    const after = await member("5055550305");
    expect(after).toMatchObject({ email: "eve@example.com", tags: ["vip", "edibles"], notes: "Prefers mornings" });
    const audits = await db.execute<{ after: unknown }>(sql`select after from audit_logs where org_id = ${actor.orgId} and action = 'PROFILE'`);
    expect(JSON.stringify(audits.rows)).not.toMatch(/eve@example|mornings/);
    await expect(updateShopperProfile(actor, { memberId: eve.id, email: "bad", tags: "", notes: "" })).rejects.toThrow(/email/i);
  });

  it("only sends a campaign to shoppers who agreed, enforces the checks, and counts results", async () => {
    await saveMarketingSettings(actor, { disclaimer: "Please Consume Responsibly.", quietStart: "21:00", quietEnd: "08:00", maxPerWeek: "3", referralBonus: "50" });
    const eve = await member("5055550305");
    await setShopperConsent(actor, { memberId: eve.id, channel: "EMAIL", agreed: true });
    const bad = await createCampaign(actor, { name: "Bad", channel: "EMAIL", subject: "Free gram", body: "Free gram with any purchase. 21+", segment: "ALL" });
    const good = await createCampaign(actor, { name: "Weekend", channel: "EMAIL", subject: "Weekend sale, {first_name}", body: "Hi {first_name}, enjoy 20% off flower this weekend. For adults 21+. Your card: {card_link}", segment: "ALL" });

    // No email provider yet: sending is refused, and nothing is marked sent.
    await expect(sendCampaign(actor, good.id)).rejects.toThrow(/Email isn't set up/);
    expect((await getCampaign(actor.orgId, good.id))!.status).toBe("DRAFT");

    process.env.RESEND_API_KEY = "test";
    process.env.MAIL_FROM = "Shop <shop@test.invalid>";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendCampaign(actor, bad.id)).rejects.toThrow(/Fix the message first/);
    expect(fetchMock).not.toHaveBeenCalled();

    const preview = await previewCampaign(actor.orgId, (await getCampaign(actor.orgId, good.id))!);
    expect(preview.reachable).toBe(2); // Ana and Eve agreed to email; Cy, Dev have no email on file
    expect(preview.problems.filter((p) => p.severity === "block")).toEqual([]);
    expect(preview.body).toMatch(/Please Consume Responsibly\./);

    const result = await sendCampaign(actor, good.id);
    expect(result.sent).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payload = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(payload.text).toMatch(/Unsubscribe: https:\/\/leaf2sale\.com\/card\//);
    expect(payload.text).toMatch(/Please Consume Responsibly\./);
    expect(payload.subject).toMatch(/^Weekend sale, /);
    const skipped = await db.select().from(campaignMessages).where(and(eq(campaignMessages.campaignId, good.id), eq(campaignMessages.status, "SKIPPED")));
    expect(skipped.map((m) => m.reason).every((r) => /agreed|No email/.test(r ?? ""))).toBe(true);

    await expect(sendCampaign(actor, good.id)).rejects.toThrow(/already sent/);
    await buy("5055550305");
    const results = await campaignResults(actor.orgId, good.id);
    expect(results.sent).toBe(2);
    expect(results.buyers).toBe(1);
    expect(Number(results.revenue)).toBeGreaterThan(0);
  });

  it("stops messaging someone who has already had the weekly limit", async () => {
    const eve = await member("5055550305");
    await saveMarketingSettings(actor, { disclaimer: "Please Consume Responsibly.", quietStart: "21:00", quietEnd: "08:00", maxPerWeek: "1", referralBonus: "50" });
    process.env.RESEND_API_KEY = "test";
    process.env.MAIL_FROM = "Shop <shop@test.invalid>";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const next = await createCampaign(actor, { name: "Again", channel: "EMAIL", subject: "Again", body: "Another offer, adults 21+.", segment: "ALL" });
    const preview = await previewCampaign(actor.orgId, (await getCampaign(actor.orgId, next.id))!);
    expect(preview.reachable).toBeGreaterThan(0);
    const result = await sendCampaign(actor, next.id);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await sentTo(eve.id)).some((m) => /times this week/.test(m.reason ?? ""))).toBe(true);
    await saveMarketingSettings(actor, { disclaimer: "Please Consume Responsibly.", quietStart: "21:00", quietEnd: "08:00", maxPerWeek: "3", referralBonus: "50" });
  });

  it("sends a turned-on automatic message once, and only to people who agreed", async () => {
    const fay = await signUp("5055550306", "Fay", { email: "fay@example.com", emailOk: true });
    const gus = await signUp("5055550307", "Gus", { email: "gus@example.com" }); // never agreed
    await db.update(rewardMembers).set({ joinedAt: sql`now() - interval '2 days'` }).where(sql`${rewardMembers.id} in (${fay.id}, ${gus.id})`);
    await expect(saveAutomation(actor, { kind: "WELCOME", enabled: "on", channel: "EMAIL", subject: "Hi", body: "Free joint for new members! 21+" })).rejects.toThrow(/turning it on/);
    await saveAutomation(actor, { kind: "WELCOME", enabled: "on", channel: "EMAIL", subject: "Welcome to {shop}", body: "Hi {first_name}, you have {points} points. {card_link} For adults 21+." });
    process.env.RESEND_API_KEY = "test";
    process.env.MAIL_FROM = "Shop <shop@test.invalid>";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await runAutomations();
    expect(first.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await sentTo(fay.id)).filter((m) => m.status === "SENT")).toHaveLength(1);
    expect(await sentTo(gus.id)).toHaveLength(0);
    const second = await runAutomations();
    expect(second.sent).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await db.update(marketingAutomations).set({ enabled: false }).where(eq(marketingAutomations.orgId, actor.orgId));
  });

  it("only exposes a shopper's card to the holder of the link", async () => {
    const eve = await member("5055550305");
    const card = await cardByToken(eve.cardToken!);
    expect(card).toMatchObject({ shop: `Loyalty Org ${run}` });
    expect(card!.member.firstName).toBe("Eve");
    expect(await cardByToken(`${eve.cardToken}x`)).toBeNull();
  });
});
