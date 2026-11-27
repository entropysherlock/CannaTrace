import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { campaignMessages, marketingSettings, memberConsents, organizations, rewardBoosts, rewardMembers, rewardTiers } from "@/db/schema";
import { db } from "./db";
import { InventoryError, audit, type Actor } from "./inventory";
import {
  CONSENT_WORDING,
  currentConsents,
  ensureCodes,
  getBoosts,
  getMarketingSettings,
  getTiers,
  recordConsent,
  spend12m,
  type Channel,
} from "./loyalty-earn";
import {
  classifySegment,
  cleanBoost,
  cleanClock,
  cleanTags,
  cleanTier,
  nextTier,
  normalizeEmail,
  tierFor,
  vipLine,
  type Segment,
  type Tier,
} from "./loyalty-math";
import { getProgram } from "./rewards";
import { memberHistory } from "./rewards";

/**
 * The CRM side of rewards: one profile per shopper (who they are, what they buy, what they agreed to), the groups
 * shoppers fall into, tiers, bonus-points days, and the numbers that show whether the program is working.
 */

const when = (v: unknown): Date | null => (v ? new Date(v as string | Date) : null);

export type Shopper = {
  id: string;
  firstName: string;
  phone: string;
  email: string | null;
  points: number;
  birthday: string | null;
  joinedAt: Date;
  lastActivityAt: Date;
  tags: string[];
  visits: number;
  lastPurchaseAt: Date | null;
  spend12m: string;
  lifetime: string;
  segment: Segment;
  tier: Tier | null;
};

/** Every shopper with their buying numbers and group, newest activity first. Capped so one huge business can't slow a page. */
export async function shopperRows(orgId: string, now = new Date()): Promise<Shopper[]> {
  const [tiers, result] = await Promise.all([
    getTiers(db, orgId),
    db.execute<Record<string, unknown>>(sql`
      select m.id, m.first_name, m.phone, m.email, m.points, m.birthday, m.joined_at, m.last_activity_at, m.tags,
        coalesce(s.visits, 0)::int as visits, s.last_purchase, coalesce(s.spend12m, 0)::text as spend12m, coalesce(s.lifetime, 0)::text as lifetime
      from reward_members m
      left join lateral (
        select count(*) as visits, max(completed_at) as last_purchase,
          sum(total) filter (where completed_at > now() - interval '12 months') as spend12m, sum(total) as lifetime
        from sales where reward_member_id = m.id and status = 'COMPLETED') s on true
      where m.org_id = ${orgId}
      order by m.last_activity_at desc
      limit 20000`),
  ]);
  const vip = vipLine(tiers);
  return result.rows.map((r) => {
    const stats = { joinedAt: when(r.joined_at)!, visits: Number(r.visits), lastPurchaseAt: when(r.last_purchase), spend12m: String(r.spend12m) };
    return {
      id: String(r.id),
      firstName: String(r.first_name),
      phone: String(r.phone),
      email: (r.email as string | null) ?? null,
      points: Number(r.points),
      birthday: (r.birthday as string | null) ?? null,
      joinedAt: stats.joinedAt,
      lastActivityAt: when(r.last_activity_at)!,
      tags: (r.tags as string[] | null) ?? [],
      visits: stats.visits,
      lastPurchaseAt: stats.lastPurchaseAt,
      spend12m: stats.spend12m,
      lifetime: String(r.lifetime),
      segment: classifySegment(stats, now, vip),
      tier: tiers.length ? tierFor(tiers, stats.spend12m) : null,
    };
  });
}

export async function segmentCounts(orgId: string): Promise<Record<Segment, number> & { total: number }> {
  const rows = await shopperRows(orgId);
  const counts = { NEW: 0, REGULAR: 0, VIP: 0, AT_RISK: 0, LAPSED: 0, total: rows.length };
  for (const r of rows) counts[r.segment]++;
  return counts;
}

export async function listShoppers(orgId: string, filter: { segment?: string; q?: string; tag?: string; page?: number; pageSize?: number }) {
  let rows = await shopperRows(orgId);
  const total = rows.length;
  if (filter.segment) rows = rows.filter((r) => r.segment === filter.segment);
  if (filter.tag) rows = rows.filter((r) => r.tags.includes(filter.tag!));
  const q = (filter.q ?? "").trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, "");
    rows = rows.filter((r) => r.firstName.toLowerCase().includes(q) || (digits.length >= 3 && r.phone.includes(digits)) || (r.email ?? "").includes(q));
  }
  const pageSize = filter.pageSize ?? 50;
  const page = Math.max(filter.page ?? 1, 1);
  return { total, matching: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}

// ---------- One shopper's profile ----------

export async function shopperProfile(orgId: string, memberId: string) {
  const [member] = await db.select().from(rewardMembers).where(and(eq(rewardMembers.id, memberId), eq(rewardMembers.orgId, orgId)));
  if (!member) return null;
  const [all, tiers, program, settings, consents, history] = await Promise.all([
    shopperRows(orgId),
    getTiers(db, orgId),
    getProgram(db, orgId),
    getMarketingSettings(db, orgId),
    currentConsents(db, orgId, [memberId]),
    memberHistory(orgId, memberId, 30),
  ]);
  const shopper = all.find((s) => s.id === memberId) ?? null;
  const [categories, items, recent, type, consentLog, messages, referrals, referrer] = await Promise.all([
    db.execute<{ name: string | null; spend: string; orders: number }>(sql`
      select c.name, sum(l.quantity * l.unit_price)::text as spend, count(distinct s.id)::int as orders
      from sale_lines l join sales s on s.id = l.sale_id join items i on i.id = l.item_id left join item_categories c on c.id = i.category_id
      where s.reward_member_id = ${memberId} and s.status = 'COMPLETED'
      group by c.name order by sum(l.quantity * l.unit_price) desc limit 5`),
    db.execute<{ name: string; strain: string | null; orders: number }>(sql`
      select i.name, i.strain, count(distinct s.id)::int as orders
      from sale_lines l join sales s on s.id = l.sale_id join items i on i.id = l.item_id
      where s.reward_member_id = ${memberId} and s.status = 'COMPLETED'
      group by i.name, i.strain order by count(distinct s.id) desc, sum(l.quantity * l.unit_price) desc limit 5`),
    db.execute<{ number: string; completed_at: Date | string; total: string }>(sql`
      select number, completed_at, total::text from sales where reward_member_id = ${memberId} and status = 'COMPLETED' order by completed_at desc limit 8`),
    db.execute<{ customer_type: string; n: number }>(sql`
      select customer_type::text, count(*)::int as n from sales where reward_member_id = ${memberId} and status = 'COMPLETED' group by customer_type order by n desc limit 1`),
    db.select().from(memberConsents).where(eq(memberConsents.memberId, memberId)).orderBy(desc(memberConsents.createdAt)).limit(20),
    db.select().from(campaignMessages).where(eq(campaignMessages.memberId, memberId)).orderBy(desc(campaignMessages.sentAt)).limit(10),
    db.execute<{ n: number }>(sql`select count(*)::int as n from reward_members where referred_by_id = ${memberId}`),
    member.referredById ? db.select({ firstName: rewardMembers.firstName }).from(rewardMembers).where(eq(rewardMembers.id, member.referredById)) : Promise.resolve([]),
  ]);
  const spend = shopper?.spend12m ?? "0";
  const codes = await ensureCodes(db, member);
  return {
    member: { ...member, ...codes },
    shopper,
    tier: shopper?.tier ?? null,
    next: tiers.length ? nextTier(tiers, spend) : null,
    categories: categories.rows,
    items: items.rows,
    recent: recent.rows.map((r) => ({ number: r.number, at: when(r.completed_at)!, total: r.total })),
    usuallyBuysAs: type.rows[0]?.customer_type ?? null,
    consent: consents.get(memberId) ?? { EMAIL: false, SMS: false },
    consentLog,
    messages,
    referralsMade: Number(referrals.rows[0]?.n ?? 0),
    referredBy: referrer[0]?.firstName ?? null,
    history,
    pointsValue: program.redeemPoints > 0 ? new Decimal(member.points).div(program.redeemPoints).mul(program.redeemDollars).toFixed(2) : "0.00",
    disclaimer: settings.disclaimer,
  };
}

/** A manager's edit of the CRM fields: email, tags and notes. Name, phone and birthday are edited on the Rewards page. */
export async function updateShopperProfile(actor: Actor, input: { memberId: string; email: unknown; tags: unknown; notes: unknown }): Promise<void> {
  const email = normalizeEmail(input.email);
  if (email === null) throw new InventoryError("That email doesn't look right. Check it or leave it blank.");
  const notes = String(input.notes ?? "").trim().slice(0, 1000);
  await db.transaction(async (tx) => {
    const [member] = await tx.select().from(rewardMembers).where(and(eq(rewardMembers.id, input.memberId), eq(rewardMembers.orgId, actor.orgId))).for("update");
    if (!member) throw new InventoryError("That shopper was not found. They may have been removed.");
    const tags = cleanTags(input.tags);
    await tx.update(rewardMembers).set({ email: email || null, tags, notes: notes || null }).where(eq(rewardMembers.id, member.id));
    // Without the email or notes themselves: the audit trail outlives the shopper.
    await audit(tx, actor, { entityType: "RewardsMember", entityId: member.id, action: "PROFILE", after: { email: Boolean(email), tags: tags.length, notes: Boolean(notes) } });
  });
}

/** A manager records what a shopper said in person or by phone. The method is noted as MANAGER. */
export async function setShopperConsent(actor: Actor, input: { memberId: string; channel: Channel; agreed: boolean }): Promise<void> {
  if (input.channel !== "EMAIL" && input.channel !== "SMS") throw new InventoryError("Pick email or text.");
  await db.transaction(async (tx) => {
    const [member] = await tx.select().from(rewardMembers).where(and(eq(rewardMembers.id, input.memberId), eq(rewardMembers.orgId, actor.orgId))).for("update");
    if (!member) throw new InventoryError("That shopper was not found. They may have been removed.");
    if (input.agreed && input.channel === "EMAIL" && !member.email) throw new InventoryError("Add the shopper's email before recording that they agreed to emails.");
    const current = (await currentConsents(tx, actor.orgId, [member.id])).get(member.id);
    if (Boolean(current?.[input.channel]) === input.agreed) return;
    await recordConsent(tx, actor, { memberId: member.id, channel: input.channel, status: input.agreed ? "OPTED_IN" : "OPTED_OUT", method: "MANAGER", wording: input.agreed ? `${CONSENT_WORDING[input.channel]} (recorded by ${actor.userName})` : null });
    await audit(tx, actor, { entityType: "RewardsMember", entityId: member.id, action: input.agreed ? "CONSENT_IN" : "CONSENT_OUT", after: { channel: input.channel } });
  });
}

// ---------- Tiers and bonus days ----------

export async function saveTier(actor: Actor, input: Record<string, unknown>): Promise<void> {
  const clean = cleanTier(input, (m) => {
    throw new InventoryError(m);
  });
  await db.transaction(async (tx) => {
    const existing = await getTiers(tx, actor.orgId);
    if (existing.length >= 8 && !existing.some((t) => t.name.toLowerCase() === clean.name.toLowerCase())) throw new InventoryError("A program can have at most 8 tiers.");
    const same = existing.find((t) => t.name.toLowerCase() === clean.name.toLowerCase());
    if (same) await tx.update(rewardTiers).set(clean).where(eq(rewardTiers.id, same.id));
    else await tx.insert(rewardTiers).values({ orgId: actor.orgId, ...clean });
    await audit(tx, actor, { entityType: "RewardsTier", entityId: same?.id ?? clean.name, action: same ? "UPDATE" : "CREATE", after: clean });
  });
}

export async function deleteTier(actor: Actor, input: { tierId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [tier] = await tx.select().from(rewardTiers).where(and(eq(rewardTiers.id, input.tierId), eq(rewardTiers.orgId, actor.orgId)));
    if (!tier) throw new InventoryError("That tier was not found.");
    await tx.delete(rewardTiers).where(eq(rewardTiers.id, tier.id));
    await audit(tx, actor, { entityType: "RewardsTier", entityId: tier.id, action: "DELETE", before: { name: tier.name } });
  });
}

export async function saveBoost(actor: Actor, input: Record<string, unknown>): Promise<void> {
  const clean = cleanBoost(input, (m) => {
    throw new InventoryError(m);
  });
  await db.transaction(async (tx) => {
    const [boost] = await tx.insert(rewardBoosts).values({ orgId: actor.orgId, ...clean }).returning();
    await audit(tx, actor, { entityType: "RewardsBoost", entityId: boost.id, action: "CREATE", after: clean });
  });
}

export async function deleteBoost(actor: Actor, input: { boostId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [boost] = await tx.select().from(rewardBoosts).where(and(eq(rewardBoosts.id, input.boostId), eq(rewardBoosts.orgId, actor.orgId)));
    if (!boost) throw new InventoryError("That bonus-points period was not found.");
    await tx.delete(rewardBoosts).where(eq(rewardBoosts.id, boost.id));
    await audit(tx, actor, { entityType: "RewardsBoost", entityId: boost.id, action: "DELETE", before: { name: boost.name } });
  });
}

export async function tierSummary(orgId: string) {
  const [tiers, rows] = await Promise.all([getTiers(db, orgId), shopperRows(orgId)]);
  return tiers.map((t) => ({ ...t, members: rows.filter((r) => r.tier?.id === t.id).length }));
}

export async function saveMarketingSettings(actor: Actor, input: Record<string, unknown>): Promise<void> {
  const fail = (m: string): never => {
    throw new InventoryError(m);
  };
  const disclaimer = String(input.disclaimer ?? "").trim().slice(0, 300);
  if (!disclaimer) fail("Type the statement every marketing message must carry. New Mexico requires one (16.8.3.8 NMAC).");
  const quietStart = cleanClock(input.quietStart, "Quiet hours start", fail);
  const quietEnd = cleanClock(input.quietEnd, "Quiet hours end", fail);
  const whole = (v: unknown, label: string, min: number, max: number) => {
    const raw = String(v ?? "").trim();
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) fail(`${label}: type a whole number from ${min} to ${max}.`);
    return Number(raw);
  };
  const maxPerWeek = whole(input.maxPerWeek, "Most messages per shopper per week", 1, 14);
  const referralBonus = whole(input.referralBonus, "Referral bonus (points)", 0, 10000);
  const values = { disclaimer, quietStart, quietEnd, maxPerWeek, referralBonus, updatedAt: new Date() };
  await db.transaction(async (tx) => {
    const before = await getMarketingSettings(tx, actor.orgId);
    await tx.insert(marketingSettings).values({ orgId: actor.orgId, ...values }).onConflictDoUpdate({ target: marketingSettings.orgId, set: values });
    await audit(tx, actor, { entityType: "MarketingSettings", entityId: actor.orgId, action: "SETTINGS", before, after: values });
  });
}

// ---------- Is it working? ----------

export async function loyaltyAnalytics(orgId: string) {
  const [rows, program, sales, cohorts, points, messages] = await Promise.all([
    shopperRows(orgId),
    getProgram(db, orgId),
    db.execute<{ total: string; members: string; n: number; nm: number }>(sql`
      select coalesce(sum(total), 0)::text as total, coalesce(sum(total) filter (where reward_member_id is not null), 0)::text as members,
        count(*)::int as n, (count(*) filter (where reward_member_id is not null))::int as nm
      from sales where org_id = ${orgId} and status = 'COMPLETED' and completed_at > now() - interval '12 months'`),
    db.execute<{ month: string }>(sql`select to_char(date_trunc('month', joined_at), 'YYYY-MM') as month from reward_members where org_id = ${orgId} and joined_at > now() - interval '7 months'`),
    db.execute<{ total: string | null }>(sql`select sum(points)::text as total from reward_members where org_id = ${orgId}`),
    db.execute<{ sent: number; failed: number; skipped: number }>(sql`
      select (count(*) filter (where status = 'SENT'))::int as sent, (count(*) filter (where status = 'FAILED'))::int as failed, (count(*) filter (where status = 'SKIPPED'))::int as skipped
      from campaign_messages where org_id = ${orgId} and sent_at > now() - interval '30 days'`),
  ]);
  const counts = { NEW: 0, REGULAR: 0, VIP: 0, AT_RISK: 0, LAPSED: 0 } as Record<Segment, number>;
  for (const r of rows) counts[r.segment]++;
  const buyers = rows.filter((r) => r.visits >= 1);
  const repeat = rows.filter((r) => r.visits >= 2);
  const total = new Decimal(sales.rows[0]?.total ?? 0);
  const memberSales = new Decimal(sales.rows[0]?.members ?? 0);
  const byMonth = new Map<string, { joined: number; cameBack: number }>();
  const months = new Set(cohorts.rows.map((c) => c.month));
  for (const month of [...months].sort()) byMonth.set(month, { joined: 0, cameBack: 0 });
  for (const r of rows) {
    const month = r.joinedAt.toISOString().slice(0, 7);
    const entry = byMonth.get(month);
    if (!entry) continue;
    entry.joined++;
    if (r.visits >= 2) entry.cameBack++;
  }
  const pointsOut = Number(points.rows[0]?.total ?? 0);
  return {
    members: rows.length,
    counts,
    repeatRate: buyers.length ? Math.round((repeat.length / buyers.length) * 100) : 0,
    avgSpend12m: buyers.length ? buyers.reduce((t, r) => t.add(r.spend12m), new Decimal(0)).div(buyers.length).toFixed(2) : "0.00",
    memberShare: total.gt(0) ? memberSales.div(total).mul(100).toDecimalPlaces(0).toNumber() : 0,
    memberSales: memberSales.toFixed(2),
    avgBasketMember: Number(sales.rows[0]?.nm ?? 0) ? memberSales.div(Number(sales.rows[0].nm)).toFixed(2) : "0.00",
    liability: program.redeemPoints > 0 ? new Decimal(pointsOut).div(program.redeemPoints).mul(program.redeemDollars).toFixed(2) : "0.00",
    pointsOut,
    cohorts: [...byMonth.entries()].map(([month, v]) => ({ month, ...v, rate: v.joined ? Math.round((v.cameBack / v.joined) * 100) : 0 })),
    messages30: { sent: Number(messages.rows[0]?.sent ?? 0), failed: Number(messages.rows[0]?.failed ?? 0), skipped: Number(messages.rows[0]?.skipped ?? 0) },
    boosts: await getBoosts(db, orgId),
  };
}

// ---------- The shopper's own card page (no sign-in: the link is the key) ----------

/** What a shopper sees on their private card page. Null for a token that doesn't exist. */
export async function cardByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [member] = await db.select().from(rewardMembers).where(eq(rewardMembers.cardToken, token));
  if (!member) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, member.orgId));
  const [program, tiers, settings, consents, history, menu] = await Promise.all([
    getProgram(db, member.orgId),
    getTiers(db, member.orgId),
    getMarketingSettings(db, member.orgId),
    currentConsents(db, member.orgId, [member.id]),
    memberHistory(member.orgId, member.id, 10),
    db.execute<{ slug: string }>(sql`select slug from online_menus where org_id = ${member.orgId} and enabled limit 1`),
  ]);
  const spend = await spend12m(db, member.id);
  return {
    member,
    shop: org?.name ?? "the store",
    tier: tiers.length ? tierFor(tiers, spend) : null,
    next: tiers.length ? nextTier(tiers, spend) : null,
    programOn: program.enabled,
    pointsValue: program.redeemPoints > 0 ? new Decimal(member.points).div(program.redeemPoints).mul(program.redeemDollars).toFixed(2) : "0.00",
    redeemPoints: program.redeemPoints,
    redeemDollars: program.redeemDollars,
    consent: consents.get(member.id) ?? { EMAIL: false, SMS: false },
    history,
    referralBonus: settings.referralBonus,
    menuSlug: menu.rows[0]?.slug ?? null,
  };
}

/** A shopper changes what they agreed to from their own card (or the unsubscribe link in an email). */
export async function cardConsent(token: string, input: { channel: Channel; agreed: boolean; method: "CARD" | "UNSUBSCRIBE" }): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(rewardMembers).where(eq(rewardMembers.cardToken, token)).for("update");
    if (!member) return false;
    if (input.agreed && input.channel === "EMAIL" && !member.email) return false;
    const current = (await currentConsents(tx, member.orgId, [member.id])).get(member.id);
    if (Boolean(current?.[input.channel]) === input.agreed) return true;
    await recordConsent(tx, { orgId: member.orgId, userName: "Shopper" }, { memberId: member.id, channel: input.channel, status: input.agreed ? "OPTED_IN" : "OPTED_OUT", method: input.method });
    return true;
  });
}
