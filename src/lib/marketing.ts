import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { brandSponsorships, campaignMessages, facilities, marketingAutomations, marketingCampaigns, organizations, promotions, rewardMembers } from "@/db/schema";
import { db } from "./db";
import { emailConfigured, sendEmail } from "./email";
import { InventoryError, audit, type Actor } from "./inventory";
import { currentConsents, ensureCodes, getMarketingSettings, type Channel, type MarketingSettings } from "./loyalty-earn";
import { shopperRows, type Shopper } from "./loyalty";
import { AUTOMATIONS, automationInfo, brandOwes, isQuietTime, renderTemplate, type AutomationKind } from "./loyalty-math";
import { checkMessage, hasBlock, prepareBody, type Problem } from "./marketing-rules";
import { SITE_URL } from "./site";
import { sendSms, smsConfigured } from "./sms";
import { facilityZone } from "./time";

/**
 * Marketing: campaigns to a group of shoppers, messages that send themselves, and what they earned.
 * Everything that sends goes through `deliver`, which is the only place consent, the weekly cap, quiet hours and the
 * message check are enforced, so a campaign and an automation can never skip them.
 */

export const MAX_RECIPIENTS = 2000;
const CAMPAIGN_SEGMENTS = ["ALL", "NEW", "REGULAR", "VIP", "AT_RISK", "LAPSED", "BIRTHDAY"];

type Org = { id: string; name: string; zone: string };

async function orgContext(orgId: string): Promise<Org> {
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  const [facility] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.orgId, orgId)).orderBy(asc(facilities.name)).limit(1);
  return { id: orgId, name: org?.name ?? "the store", zone: facility ? await facilityZone(facility.id) : "America/Denver" };
}

const localParts = (now: Date, zone: string) => {
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", ...o }).format(now);
  return { date: fmt({ year: "numeric", month: "2-digit", day: "2-digit" }), time: fmt({ hour: "2-digit", minute: "2-digit" }) };
};

// ---------- Who a campaign reaches ----------

export function segmentLabelFor(segment: string, categories: Map<string, string>): string {
  if (segment === "ALL") return "Everyone";
  if (segment === "BIRTHDAY") return "Birthday this month";
  if (segment.startsWith("FAVORITE:")) return `Buys ${categories.get(segment.slice(9)) ?? "a category"}`;
  return { NEW: "New shoppers", REGULAR: "Regulars", VIP: "VIPs", AT_RISK: "At risk", LAPSED: "Lapsed" }[segment] ?? segment;
}

export async function audienceFor(orgId: string, segment: string, zone: string, now = new Date()): Promise<Shopper[]> {
  const rows = await shopperRows(orgId, now);
  if (segment === "ALL") return rows;
  if (segment === "BIRTHDAY") {
    const month = localParts(now, zone).date.slice(5, 7);
    return rows.filter((r) => r.birthday?.slice(0, 2) === month);
  }
  if (segment.startsWith("FAVORITE:")) {
    const categoryId = segment.slice(9);
    const bought = await db.execute<{ id: string }>(sql`
      select distinct s.reward_member_id as id from sales s join sale_lines l on l.sale_id = s.id join items i on i.id = l.item_id
      where s.org_id = ${orgId} and s.status = 'COMPLETED' and s.completed_at > now() - interval '12 months' and s.reward_member_id is not null and i.category_id = ${categoryId}`);
    const ids = new Set(bought.rows.map((r) => r.id));
    return rows.filter((r) => ids.has(r.id));
  }
  if (!CAMPAIGN_SEGMENTS.includes(segment)) throw new InventoryError("Pick who the message goes to.");
  return rows.filter((r) => r.segment === segment);
}

// ---------- Sending one message ----------

export type Outcome = { status: "SENT" | "SKIPPED" | "FAILED"; reason?: string };

async function recentCount(memberId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from campaign_messages where member_id = ${memberId} and status = 'SENT' and sent_at > now() - interval '7 days'`);
  return Number(result.rows[0]?.n ?? 0);
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Send one message to one shopper, enforcing every rule, and record what happened. Returns SKIPPED with a plain reason when
 * a rule says no (and records it), so nothing is ever skipped silently.
 */
export async function deliver(
  org: Org,
  settings: MarketingSettings,
  shopper: Shopper,
  consent: { EMAIL: boolean; SMS: boolean } | undefined,
  message: { channel: Channel; subject: string; body: string; campaignId?: string; automationKind?: AutomationKind },
  now = new Date(),
): Promise<Outcome> {
  const record = async (outcome: Outcome) => {
    await db.insert(campaignMessages).values({
      orgId: org.id,
      memberId: shopper.id,
      campaignId: message.campaignId ?? null,
      automationKind: message.automationKind ?? null,
      channel: message.channel,
      status: outcome.status,
      reason: outcome.reason ?? null,
    });
    return outcome;
  };
  const skip = (reason: string) => record({ status: "SKIPPED", reason });
  if (!consent?.[message.channel]) return skip(message.channel === "EMAIL" ? "Hasn't agreed to emails" : "Hasn't agreed to texts");
  if (message.channel === "EMAIL" && !shopper.email) return skip("No email on file");
  if (message.channel === "SMS" && isQuietTime(localParts(now, org.zone).time, settings.quietStart, settings.quietEnd)) return skip("Quiet hours");
  if ((await recentCount(shopper.id)) >= settings.maxPerWeek) return skip(`Already messaged ${settings.maxPerWeek} times this week`);

  const [member] = await db.select().from(rewardMembers).where(eq(rewardMembers.id, shopper.id));
  if (!member) return skip("Shopper was removed");
  const codes = await ensureCodes(db, member);
  const cardLink = `${SITE_URL}/card/${codes.cardToken}`;
  const values = { firstName: shopper.firstName, shop: org.name, points: shopper.points, cardLink, referralCode: codes.referralCode };
  const body = prepareBody(message.channel, renderTemplate(message.body, values), settings.disclaimer);
  const subject = renderTemplate(message.subject, values);
  if (hasBlock(checkMessage({ channel: message.channel, subject, body, disclaimer: settings.disclaimer }))) return skip("Blocked by the message check");

  if (message.channel === "EMAIL") {
    const unsubscribe = `${cardLink}/unsubscribe`;
    const text = `${body}\n\n${org.name}\nUnsubscribe: ${unsubscribe}`;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1e293b;max-width:560px">${escapeHtml(body).replace(/\n/g, "<br>")}<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px"><p style="font-size:12px;color:#64748b">${escapeHtml(org.name)} · <a href="${unsubscribe}">Unsubscribe</a></p></div>`;
    const sent = await sendEmail({ to: shopper.email!, subject, html, text });
    return record(sent.sent ? { status: "SENT" } : { status: "FAILED", reason: sent.reason?.slice(0, 200) });
  }
  const sent = await sendSms({ phone: shopper.phone, body });
  return record(sent.sent ? { status: "SENT" } : { status: "FAILED", reason: sent.reason?.slice(0, 200) });
}

// ---------- Campaigns ----------

export type Campaign = typeof marketingCampaigns.$inferSelect;

function cleanCampaign(input: Record<string, unknown>) {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) throw new InventoryError("Give the campaign a name only you will see, for example Weekend 4/20 push.");
  const channel = input.channel === "SMS" ? "SMS" : input.channel === "EMAIL" ? "EMAIL" : null;
  if (!channel) throw new InventoryError("Pick email or text.");
  const subject = String(input.subject ?? "").trim().slice(0, 120);
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 4000);
  if (!body) throw new InventoryError("Write the message.");
  const segment = String(input.segment ?? "ALL");
  if (!CAMPAIGN_SEGMENTS.includes(segment) && !/^FAVORITE:[\w-]{1,60}$/.test(segment)) throw new InventoryError("Pick who the message goes to.");
  return { name, channel, subject: channel === "EMAIL" ? subject : null, body, segment };
}

export async function createCampaign(actor: Actor, input: Record<string, unknown>): Promise<Campaign> {
  const clean = cleanCampaign(input);
  return db.transaction(async (tx) => {
    const [campaign] = await tx.insert(marketingCampaigns).values({ orgId: actor.orgId, createdBy: actor.userName, ...clean }).returning();
    await audit(tx, actor, { entityType: "Campaign", entityId: campaign.id, action: "CREATE", after: { channel: clean.channel, segment: clean.segment } });
    return campaign;
  });
}

export async function updateCampaign(actor: Actor, id: string, input: Record<string, unknown>): Promise<void> {
  const clean = cleanCampaign(input);
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.orgId, actor.orgId))).for("update");
    if (!c) throw new InventoryError("That campaign was not found.");
    if (c.status !== "DRAFT") throw new InventoryError("A sent campaign can't be changed. Copy it into a new one.");
    await tx.update(marketingCampaigns).set(clean).where(eq(marketingCampaigns.id, id));
    await audit(tx, actor, { entityType: "Campaign", entityId: id, action: "UPDATE", after: { channel: clean.channel, segment: clean.segment } });
  });
}

export async function deleteCampaign(actor: Actor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.orgId, actor.orgId))).for("update");
    if (!c) throw new InventoryError("That campaign was not found.");
    if (c.status !== "DRAFT") throw new InventoryError("A sent campaign is kept for the record. Only drafts can be deleted.");
    await tx.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
    await audit(tx, actor, { entityType: "Campaign", entityId: id, action: "DELETE" });
  });
}

export async function listCampaigns(orgId: string) {
  return db.select().from(marketingCampaigns).where(eq(marketingCampaigns.orgId, orgId)).orderBy(desc(marketingCampaigns.createdAt)).limit(100);
}

export async function getCampaign(orgId: string, id: string): Promise<Campaign | null> {
  const [c] = await db.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.orgId, orgId)));
  return c ?? null;
}

/** What would happen if this draft were sent now: the message check, who it reaches and why others are left out. */
export async function previewCampaign(orgId: string, campaign: Campaign, now = new Date()) {
  const [org, settings] = await Promise.all([orgContext(orgId), getMarketingSettings(db, orgId)]);
  const audience = await audienceFor(orgId, campaign.segment, org.zone, now);
  const consents = await currentConsents(db, orgId);
  const channel = campaign.channel as Channel;
  let reachable = 0;
  const left = { noConsent: 0, noEmail: 0 };
  for (const s of audience) {
    const c = consents.get(s.id);
    if (!c?.[channel]) left.noConsent++;
    else if (channel === "EMAIL" && !s.email) left.noEmail++;
    else reachable++;
  }
  const sample = { firstName: "Alex", shop: org.name, points: 120, cardLink: `${SITE_URL}/card/…`, referralCode: "ABC234" };
  const body = prepareBody(channel, renderTemplate(campaign.body, sample), settings.disclaimer);
  const problems: Problem[] = checkMessage({ channel, subject: renderTemplate(campaign.subject ?? "", sample), body, disclaimer: settings.disclaimer });
  const provider = channel === "EMAIL" ? emailConfigured() : smsConfigured();
  const quiet = channel === "SMS" && isQuietTime(localParts(now, org.zone).time, settings.quietStart, settings.quietEnd);
  return { audience: audience.length, reachable: Math.min(reachable, MAX_RECIPIENTS), overLimit: reachable > MAX_RECIPIENTS, left, body, problems, provider, quiet, settings, orgName: org.name };
}

/**
 * Send a draft. The campaign is marked sent first (only one request can win that), then each reachable shopper is messaged.
 * Shoppers a rule leaves out are recorded with the reason.
 */
export async function sendCampaign(actor: Actor, id: string, now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const campaign = await getCampaign(actor.orgId, id);
  if (!campaign) throw new InventoryError("That campaign was not found.");
  if (campaign.status !== "DRAFT") throw new InventoryError("That campaign was already sent.");
  const preview = await previewCampaign(actor.orgId, campaign, now);
  if (hasBlock(preview.problems)) throw new InventoryError(`Fix the message first: ${preview.problems.find((p) => p.severity === "block")!.message}`);
  if (!preview.provider) throw new InventoryError(campaign.channel === "EMAIL" ? "Email isn't set up yet (RESEND_API_KEY and MAIL_FROM)." : "Texting isn't set up yet (SMS_WEBHOOK_URL and SMS_WEBHOOK_SECRET).");
  if (preview.quiet) throw new InventoryError(`Texts aren't sent between ${preview.settings.quietStart} and ${preview.settings.quietEnd} (quiet hours). Try again later.`);
  if (preview.overLimit) throw new InventoryError(`This reaches more than ${MAX_RECIPIENTS} shoppers. Pick a narrower group and send in parts.`);
  if (preview.reachable === 0) throw new InventoryError("Nobody in this group can be messaged: they haven't agreed, or have no email. Pick another group.");

  const claimed = await db
    .update(marketingCampaigns)
    .set({ status: "SENT", sentAt: now, sentBy: actor.userName })
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.status, "DRAFT")))
    .returning({ id: marketingCampaigns.id });
  if (!claimed.length) throw new InventoryError("That campaign was already sent.");

  const org = await orgContext(actor.orgId);
  const consents = await currentConsents(db, actor.orgId);
  const audience = await audienceFor(actor.orgId, campaign.segment, org.zone, now);
  const tally = { sent: 0, skipped: 0, failed: 0 };
  const queue = audience.slice();
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const outcome = await deliver(org, preview.settings, s, consents.get(s.id), { channel: campaign.channel as Channel, subject: campaign.subject ?? "", body: campaign.body, campaignId: campaign.id }, now);
      tally[outcome.status === "SENT" ? "sent" : outcome.status === "FAILED" ? "failed" : "skipped"]++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  await db.update(marketingCampaigns).set({ recipientCount: tally.sent }).where(eq(marketingCampaigns.id, id));
  await db.transaction((tx) => audit(tx, actor, { entityType: "Campaign", entityId: id, action: "SEND", after: tally }));
  return tally;
}

/** What a sent campaign earned: shoppers who bought within 7 days after their message, and what they spent. */
export async function campaignResults(orgId: string, campaignId: string) {
  const [counts, bought, skips] = await Promise.all([
    db.execute<{ sent: number; failed: number; skipped: number }>(sql`
      select (count(*) filter (where status = 'SENT'))::int as sent, (count(*) filter (where status = 'FAILED'))::int as failed, (count(*) filter (where status = 'SKIPPED'))::int as skipped
      from campaign_messages where campaign_id = ${campaignId} and org_id = ${orgId}`),
    db.execute<{ buyers: number; orders: number; revenue: string | null }>(sql`
      select count(distinct m.member_id)::int as buyers, count(distinct s.id)::int as orders, sum(s.total)::text as revenue
      from campaign_messages m join sales s on s.reward_member_id = m.member_id and s.status = 'COMPLETED' and s.completed_at >= m.sent_at and s.completed_at < m.sent_at + interval '7 days'
      where m.campaign_id = ${campaignId} and m.org_id = ${orgId} and m.status = 'SENT'`),
    db.execute<{ reason: string; n: number }>(sql`select coalesce(reason, 'Unknown') as reason, count(*)::int as n from campaign_messages where campaign_id = ${campaignId} and org_id = ${orgId} and status <> 'SENT' group by reason order by n desc`),
  ]);
  const sent = Number(counts.rows[0]?.sent ?? 0);
  const buyers = Number(bought.rows[0]?.buyers ?? 0);
  return {
    sent,
    failed: Number(counts.rows[0]?.failed ?? 0),
    skipped: Number(counts.rows[0]?.skipped ?? 0),
    buyers,
    orders: Number(bought.rows[0]?.orders ?? 0),
    revenue: new Decimal(bought.rows[0]?.revenue ?? 0).toFixed(2),
    rate: sent ? Math.round((buyers / sent) * 100) : 0,
    skipReasons: skips.rows,
  };
}

// ---------- Messages that send themselves ----------

export async function listAutomations(orgId: string) {
  const saved = await db.select().from(marketingAutomations).where(eq(marketingAutomations.orgId, orgId));
  return AUTOMATIONS.map((a) => {
    const row = saved.find((s) => s.kind === a.kind);
    return { kind: a.kind, label: a.label, when: a.when, enabled: row?.enabled ?? false, channel: (row?.channel ?? "EMAIL") as Channel, subject: row?.subject ?? a.subject, body: row?.body ?? a.body };
  });
}

export async function saveAutomation(actor: Actor, input: Record<string, unknown>): Promise<void> {
  const info = automationInfo(String(input.kind ?? ""));
  if (!info) throw new InventoryError("That isn't one of the automatic messages.");
  const channel: Channel = input.channel === "SMS" ? "SMS" : "EMAIL";
  const subject = String(input.subject ?? "").trim().slice(0, 120);
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
  if (!body) throw new InventoryError("Write the message.");
  if (channel === "EMAIL" && !subject) throw new InventoryError("Add a subject line.");
  const enabled = input.enabled === true || input.enabled === "on" || input.enabled === "true";
  const settings = await getMarketingSettings(db, actor.orgId);
  const sample = { firstName: "Alex", shop: "the shop", points: 100, cardLink: `${SITE_URL}/card/…`, referralCode: "ABC234" };
  const problems = checkMessage({ channel, subject: renderTemplate(subject, sample), body: prepareBody(channel, renderTemplate(body, sample), settings.disclaimer), disclaimer: settings.disclaimer });
  const blocking = problems.find((p) => p.severity === "block");
  if (enabled && blocking) throw new InventoryError(`Fix the message before turning it on: ${blocking.message}`);
  const values = { enabled, channel, subject: subject || info.subject, body, updatedAt: new Date() };
  await db.transaction(async (tx) => {
    await tx.insert(marketingAutomations).values({ orgId: actor.orgId, kind: info.kind, ...values }).onConflictDoUpdate({ target: [marketingAutomations.orgId, marketingAutomations.kind], set: values });
    await audit(tx, actor, { entityType: "MarketingAutomation", entityId: info.kind, action: enabled ? "ENABLE" : "SAVE", after: { channel, enabled } });
  });
}

const monthOf = (d: string) => d.slice(5, 7);

/** Who should get an automatic message today, judged only from their record (consent and caps are checked at sending). */
export function dueFor(kind: AutomationKind, s: Shopper, today: string, now: Date): boolean {
  const days = (d: Date | null) => (d ? Math.floor((now.getTime() - d.getTime()) / 86_400_000) : null);
  switch (kind) {
    case "WELCOME": {
      const since = days(s.joinedAt)!;
      return since >= 1 && since <= 7;
    }
    case "SECOND_VISIT": {
      const since = days(s.lastPurchaseAt);
      return s.visits === 1 && since !== null && since >= 14 && since <= 45;
    }
    case "BIRTHDAY":
      return Boolean(s.birthday) && s.birthday!.slice(0, 2) === monthOf(today);
    case "WIN_BACK_30":
    case "WIN_BACK_60":
    case "WIN_BACK_90": {
      const from = Number(kind.slice(9));
      const since = days(s.lastPurchaseAt);
      return s.visits >= 1 && since !== null && since >= from && since < from + 15;
    }
  }
}

/** Whether this shopper already got this automatic message for the same reason (so a daily run never repeats it). */
function alreadySent(kind: AutomationKind, s: Shopper, last: Date | undefined, today: string): boolean {
  if (!last) return false;
  if (kind === "WELCOME" || kind === "SECOND_VISIT") return true;
  if (kind === "BIRTHDAY") return last.toISOString().slice(0, 4) === today.slice(0, 4);
  return s.lastPurchaseAt ? last > s.lastPurchaseAt : true;
}

/** The daily run: every business's turned-on automatic messages. Returns totals for the job record. */
export async function runAutomations(now = new Date()): Promise<{ businesses: number; sent: number; skipped: number; failed: number }> {
  const enabled = await db.select().from(marketingAutomations).where(eq(marketingAutomations.enabled, true));
  const byOrg = new Map<string, typeof enabled>();
  for (const a of enabled) byOrg.set(a.orgId, [...(byOrg.get(a.orgId) ?? []), a]);
  const totals = { businesses: 0, sent: 0, skipped: 0, failed: 0 };
  for (const [orgId, automations] of byOrg) {
    totals.businesses++;
    const [org, settings, rows, consents, history] = await Promise.all([
      orgContext(orgId),
      getMarketingSettings(db, orgId),
      shopperRows(orgId, now),
      currentConsents(db, orgId),
      db.execute<{ member_id: string; automation_kind: string; last: Date | string }>(sql`
        select member_id, automation_kind, max(sent_at) as last from campaign_messages where org_id = ${orgId} and automation_kind is not null and status = 'SENT' group by member_id, automation_kind`),
    ]);
    const today = localParts(now, org.zone).date;
    const lastSent = new Map(history.rows.map((h) => [`${h.member_id}:${h.automation_kind}`, new Date(h.last as string)]));
    for (const a of automations) {
      const kind = a.kind as AutomationKind;
      let handled = 0;
      for (const s of rows) {
        if (handled >= MAX_RECIPIENTS) break;
        if (!dueFor(kind, s, today, now) || alreadySent(kind, s, lastSent.get(`${s.id}:${kind}`), today)) continue;
        const consent = consents.get(s.id);
        // A shopper who hasn't agreed isn't recorded as "skipped" every day: nothing is logged for them.
        if (!consent?.[a.channel as Channel]) continue;
        const outcome = await deliver(org, settings, s, consent, { channel: a.channel as Channel, subject: a.subject, body: a.body, automationKind: kind }, now);
        handled++;
        totals[outcome.status === "SENT" ? "sent" : outcome.status === "FAILED" ? "failed" : "skipped"]++;
      }
    }
  }
  return totals;
}

// ---------- Brand-funded promotions ----------

export async function sponsorships(orgId: string) {
  const [promos, links] = await Promise.all([
    db.select({ id: promotions.id, name: promotions.name, active: promotions.active, kind: promotions.kind, amount: promotions.amount }).from(promotions).where(eq(promotions.orgId, orgId)).orderBy(asc(promotions.name)),
    db.select().from(brandSponsorships).where(eq(brandSponsorships.orgId, orgId)),
  ]);
  return promos.map((p) => ({ ...p, sponsor: links.find((l) => l.promoId === p.id) ?? null }));
}

export async function saveSponsorship(actor: Actor, input: { promoId: unknown; brandName: unknown; fundedPercent: unknown; note: unknown }): Promise<void> {
  const brandName = String(input.brandName ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!brandName) throw new InventoryError("Type the brand that is paying.");
  const raw = String(input.fundedPercent ?? "").trim().replace(/%$/, "");
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) throw new InventoryError("Share the brand pays: type a whole percent from 1 to 100.");
  const note = String(input.note ?? "").trim().slice(0, 200) || null;
  await db.transaction(async (tx) => {
    const [promo] = await tx.select().from(promotions).where(and(eq(promotions.id, String(input.promoId ?? "")), eq(promotions.orgId, actor.orgId)));
    if (!promo) throw new InventoryError("Pick one of your promotions.");
    const values = { brandName, fundedPercent: Number(raw), note };
    await tx.insert(brandSponsorships).values({ orgId: actor.orgId, promoId: promo.id, ...values }).onConflictDoUpdate({ target: brandSponsorships.promoId, set: values });
    await audit(tx, actor, { entityType: "BrandSponsorship", entityId: promo.id, action: "SAVE", after: { brandName, fundedPercent: Number(raw) } });
  });
}

export async function removeSponsorship(actor: Actor, input: { promoId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(brandSponsorships).where(and(eq(brandSponsorships.promoId, input.promoId), eq(brandSponsorships.orgId, actor.orgId)));
    await audit(tx, actor, { entityType: "BrandSponsorship", entityId: input.promoId, action: "REMOVE" });
  });
}

/** What each brand owes for a date range: its share of the discount dollars the register gave on completed sales. */
export async function brandStatement(orgId: string, from: string, to: string) {
  const result = await db.execute<{ brand: string; promo: string; percent: number; sales: number; given: string }>(sql`
    select b.brand_name as brand, p.name as promo, b.funded_percent as percent, count(distinct sp.sale_id)::int as sales, sum(sp.amount)::text as given
    from sale_promotions sp
    join sales s on s.id = sp.sale_id and s.status = 'COMPLETED'
    join brand_sponsorships b on b.promo_id = sp.promo_id
    join promotions p on p.id = sp.promo_id
    where sp.org_id = ${orgId} and s.completed_at >= ${from}::date and s.completed_at < (${to}::date + 1)
    group by b.brand_name, p.name, b.funded_percent order by b.brand_name, p.name`);
  const lines = result.rows.map((r) => ({ brand: r.brand, promo: r.promo, percent: Number(r.percent), sales: Number(r.sales), given: new Decimal(r.given ?? 0).toFixed(2), owes: brandOwes(r.given ?? 0, Number(r.percent)) }));
  const brands = new Map<string, { brand: string; given: Decimal; owes: Decimal }>();
  for (const l of lines) {
    const e = brands.get(l.brand) ?? { brand: l.brand, given: new Decimal(0), owes: new Decimal(0) };
    e.given = e.given.add(l.given);
    e.owes = e.owes.add(l.owes);
    brands.set(l.brand, e);
  }
  return { lines, brands: [...brands.values()].map((b) => ({ brand: b.brand, given: b.given.toFixed(2), owes: b.owes.toFixed(2) })) };
}
