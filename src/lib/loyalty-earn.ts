import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { memberConsents, marketingSettings, rewardBoosts, rewardExclusions, rewardMembers, rewardTiers } from "@/db/schema";
import { db, type Tx } from "./db";
import { boostPercent, codeFromBytes, speedFor, tierFor, type Exclusions, type StackMode, type Tier } from "./loyalty-math";

/**
 * The small pieces the register and the sale-settling code need: a shopper's tier and earning speed, their private card and
 * referral code, and what they agreed to hear about. The management screens and analytics are in loyalty.ts.
 */

type Reader = Tx | typeof db;

export type Channel = "EMAIL" | "SMS";

export async function getTiers(reader: Reader, orgId: string): Promise<Tier[]> {
  const rows = await reader.select().from(rewardTiers).where(eq(rewardTiers.orgId, orgId)).orderBy(asc(rewardTiers.minSpend));
  return rows.map((r) => ({ id: r.id, name: r.name, minSpend: r.minSpend, earnPercent: r.earnPercent, perk: r.perk }));
}

export async function getBoosts(reader: Reader, orgId: string) {
  return reader.select().from(rewardBoosts).where(eq(rewardBoosts.orgId, orgId)).orderBy(desc(rewardBoosts.startDate));
}

export type MarketingSettings = { disclaimer: string; quietStart: string; quietEnd: string; maxPerWeek: number; referralBonus: number; stackMode: StackMode; doubleOptIn: boolean };
export const DEFAULT_MARKETING: MarketingSettings = { disclaimer: "Please Consume Responsibly.", quietStart: "21:00", quietEnd: "08:00", maxPerWeek: 3, referralBonus: 50, stackMode: "MULTIPLY", doubleOptIn: false };

export async function getMarketingSettings(reader: Reader, orgId: string): Promise<MarketingSettings & { saved: boolean }> {
  const [row] = await reader.select().from(marketingSettings).where(eq(marketingSettings.orgId, orgId));
  if (!row) return { ...DEFAULT_MARKETING, saved: false };
  return { disclaimer: row.disclaimer, quietStart: row.quietStart, quietEnd: row.quietEnd, maxPerWeek: row.maxPerWeek, referralBonus: row.referralBonus, stackMode: row.stackMode === "BEST" ? "BEST" : "MULTIPLY", doubleOptIn: row.doubleOptIn, saved: true };
}

/** What a shopper spent over the last 12 months on completed sales. */
export async function spend12m(reader: Reader, memberId: string): Promise<Decimal> {
  const result = await reader.execute<{ total: string | null }>(
    sql`select sum(total)::text as total from sales where reward_member_id = ${memberId} and status = 'COMPLETED' and completed_at > now() - interval '12 months'`,
  );
  return new Decimal(result.rows[0]?.total ?? 0);
}

/** How fast this shopper earns right now, as a percent (100 = normal): their tier's speed times any bonus-points day. */
export async function earnSpeedFor(reader: Reader, orgId: string, memberId: string, today: string): Promise<{ percent: number; tier: Tier | null; boost: number }> {
  const [tiers, boosts, settings] = await Promise.all([getTiers(reader, orgId), getBoosts(reader, orgId), getMarketingSettings(reader, orgId)]);
  const tier = tiers.length ? tierFor(tiers, await spend12m(reader, memberId)) : null;
  const boost = boostPercent(boosts, today);
  return { percent: speedFor(tier?.earnPercent ?? 100, boost, settings.stackMode), tier, boost };
}

/** The categories and items that don't earn points and can't be paid for with rewards. */
export async function getExclusions(reader: Reader, orgId: string): Promise<Exclusions> {
  const rows = await reader.select().from(rewardExclusions).where(eq(rewardExclusions.orgId, orgId));
  return { categories: new Set(rows.filter((r) => r.kind === "CATEGORY").map((r) => r.refId)), items: new Set(rows.filter((r) => r.kind === "ITEM").map((r) => r.refId)) };
}

/** A private, unguessable address for the shopper's own card page. */
export const newCardToken = () => randomBytes(24).toString("base64url");

/** Give a shopper a card link and a referral code if they don't have them yet. Safe to call any time. */
export async function ensureCodes(reader: Reader, member: { id: string; orgId: string; cardToken: string | null; referralCode: string | null }): Promise<{ cardToken: string; referralCode: string }> {
  if (member.cardToken && member.referralCode) return { cardToken: member.cardToken, referralCode: member.referralCode };
  const cardToken = member.cardToken ?? newCardToken();
  let referralCode = member.referralCode;
  for (let attempt = 0; !referralCode && attempt < 8; attempt++) {
    const candidate = codeFromBytes(randomBytes(6));
    const [taken] = await reader.select({ id: rewardMembers.id }).from(rewardMembers).where(and(eq(rewardMembers.orgId, member.orgId), eq(rewardMembers.referralCode, candidate)));
    if (!taken) referralCode = candidate;
  }
  if (!referralCode) throw new Error("Could not make a referral code.");
  await reader.update(rewardMembers).set({ cardToken, referralCode }).where(eq(rewardMembers.id, member.id));
  return { cardToken, referralCode };
}

export async function findByReferralCode(reader: Reader, orgId: string, code: string) {
  if (!code) return null;
  const [m] = await reader.select().from(rewardMembers).where(and(eq(rewardMembers.orgId, orgId), eq(rewardMembers.referralCode, code)));
  return m ?? null;
}

// ---------- What shoppers agreed to ----------

/** The wording shown at the register when a shopper agrees to hear from the store. Saved with the agreement. */
export const CONSENT_WORDING: Record<Channel, string> = {
  EMAIL: "I agree to get marketing emails from this store. I can unsubscribe any time.",
  SMS: "I agree to get recurring marketing text messages from this store at the number I gave. Message and data rates may apply. Reply STOP to cancel.",
};

export async function recordConsent(
  reader: Reader,
  who: { orgId: string; userName: string },
  input: { memberId: string; channel: Channel; status: "OPTED_IN" | "OPTED_OUT" | "PENDING"; method: "REGISTER" | "CARD" | "STOP_REPLY" | "UNSUBSCRIBE" | "MANAGER" | "CONFIRM_REPLY"; wording?: string | null },
): Promise<void> {
  await reader.insert(memberConsents).values({
    orgId: who.orgId,
    memberId: input.memberId,
    channel: input.channel,
    status: input.status,
    method: input.method,
    wording: input.status !== "OPTED_OUT" ? (input.wording ?? CONSENT_WORDING[input.channel]) : (input.wording ?? null),
    recordedBy: who.userName,
  });
}

/** The newest choice per shopper for each channel: a map of memberId to { EMAIL, SMS } where true means they agreed. */
export async function currentConsents(reader: Reader, orgId: string, memberIds?: string[]): Promise<Map<string, { EMAIL: boolean; SMS: boolean }>> {
  const result = await reader.execute<{ member_id: string; channel: string; status: string }>(
    memberIds
      ? sql`select distinct on (member_id, channel) member_id, channel, status from member_consents
          where org_id = ${orgId} and member_id in (${sql.join(memberIds.map((i) => sql`${i}`), sql`, `)}) order by member_id, channel, created_at desc, id desc`
      : sql`select distinct on (member_id, channel) member_id, channel, status from member_consents where org_id = ${orgId} order by member_id, channel, created_at desc, id desc`,
  );
  const map = new Map<string, { EMAIL: boolean; SMS: boolean }>();
  for (const r of result.rows) {
    const entry = map.get(r.member_id) ?? { EMAIL: false, SMS: false };
    if (r.channel === "EMAIL" || r.channel === "SMS") entry[r.channel] = r.status === "OPTED_IN";
    map.set(r.member_id, entry);
  }
  return map;
}

/** Which shoppers said yes but haven't confirmed yet (double opt-in): a set of "memberId:CHANNEL". */
export async function pendingConsents(reader: Reader, orgId: string, memberIds: string[]): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const result = await reader.execute<{ member_id: string; channel: string; status: string }>(
    sql`select distinct on (member_id, channel) member_id, channel, status from member_consents
      where org_id = ${orgId} and member_id in (${sql.join(memberIds.map((i) => sql`${i}`), sql`, `)}) order by member_id, channel, created_at desc, id desc`,
  );
  return new Set(result.rows.filter((r) => r.status === "PENDING").map((r) => `${r.member_id}:${r.channel}`));
}
