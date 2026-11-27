import Decimal from "decimal.js";

/**
 * Loyalty and CRM math, kept free of the database so every rule can be tested on its own:
 * which group a shopper falls in, their tier, how fast they earn points, when a text may be sent.
 */

// ---------- Segments ----------

export type Segment = "NEW" | "REGULAR" | "VIP" | "AT_RISK" | "LAPSED";

export const SEGMENTS: { key: Segment; label: string; detail: string }[] = [
  { key: "VIP", label: "VIPs", detail: "Bought in the last 45 days and spent at or above the VIP amount over the last 12 months." },
  { key: "REGULAR", label: "Regulars", detail: "Bought in the last 45 days and have shopped more than once." },
  { key: "NEW", label: "New", detail: "Joined or first bought recently and have shopped once at most." },
  { key: "AT_RISK", label: "At risk", detail: "Last bought 46 to 90 days ago. The best time to win them back." },
  { key: "LAPSED", label: "Lapsed", detail: "Haven't bought in over 90 days, or joined and never came back." },
];

export const segmentLabel = (key: string): string => SEGMENTS.find((s) => s.key === key)?.label ?? key;

export type ShopperStats = {
  joinedAt: Date;
  /** Completed sales, all time. */
  visits: number;
  lastPurchaseAt: Date | null;
  /** Dollars paid over the last 12 months. */
  spend12m: Decimal.Value;
};

export const AT_RISK_DAYS = 45;
export const LAPSED_DAYS = 90;
export const NEW_DAYS = 30;
/** Used for the VIP line when a business hasn't set tiers. */
export const DEFAULT_VIP_SPEND = 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Which group a shopper belongs to today. Every shopper is in exactly one. */
export function classifySegment(stats: ShopperStats, now: Date, vipSpend: Decimal.Value = DEFAULT_VIP_SPEND): Segment {
  if (!stats.lastPurchaseAt || stats.visits === 0) return daysBetween(stats.joinedAt, now) <= NEW_DAYS ? "NEW" : "LAPSED";
  const since = daysBetween(stats.lastPurchaseAt, now);
  if (since > LAPSED_DAYS) return "LAPSED";
  if (since > AT_RISK_DAYS) return "AT_RISK";
  if (new Decimal(stats.spend12m).gte(vipSpend) && new Decimal(vipSpend).gt(0)) return "VIP";
  return stats.visits <= 1 ? "NEW" : "REGULAR";
}

// ---------- Tiers ----------

export type Tier = { id: string; name: string; minSpend: Decimal.Value; earnPercent: number; perk?: string | null };

/** The highest tier the shopper's last-12-month spending reaches, or null when no tier is reached. */
export function tierFor(tiers: Tier[], spend12m: Decimal.Value): Tier | null {
  const spend = new Decimal(spend12m);
  const reached = tiers.filter((t) => spend.gte(t.minSpend)).sort((a, b) => new Decimal(b.minSpend).comparedTo(a.minSpend));
  return reached[0] ?? null;
}

/** The next tier up and the dollars still needed to reach it, or null at the top. */
export function nextTier(tiers: Tier[], spend12m: Decimal.Value): { tier: Tier; remaining: string } | null {
  const spend = new Decimal(spend12m);
  const above = tiers.filter((t) => new Decimal(t.minSpend).gt(spend)).sort((a, b) => new Decimal(a.minSpend).comparedTo(b.minSpend));
  return above[0] ? { tier: above[0], remaining: new Decimal(above[0].minSpend).sub(spend).toFixed(2) } : null;
}

/** The spending line for VIPs: the top tier's amount when tiers are set, otherwise the default. */
export function vipLine(tiers: Tier[]): Decimal {
  if (!tiers.length) return new Decimal(DEFAULT_VIP_SPEND);
  return tiers.reduce((top, t) => (new Decimal(t.minSpend).gt(top) ? new Decimal(t.minSpend) : top), new Decimal(0));
}

export function cleanTier(input: Record<string, unknown>, fail: (message: string) => never): { name: string; minSpend: string; earnPercent: number; perk: string | null } {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  if (!name) fail("Give the tier a name, for example Gold.");
  const spendRaw = String(input.minSpend ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(spendRaw) || Number(spendRaw) > 1_000_000) fail("Spend to reach it: type dollars over 12 months, like 500.");
  const percentRaw = String(input.earnPercent ?? "").trim().replace(/%$/, "");
  if (!/^\d+$/.test(percentRaw) || Number(percentRaw) < 100 || Number(percentRaw) > 500) fail("Points speed: type a percent from 100 (normal) to 500, like 125 for 25% more points.");
  const perk = String(input.perk ?? "").trim().slice(0, 120);
  return { name, minSpend: new Decimal(spendRaw).toFixed(2), earnPercent: Number(percentRaw), perk: perk || null };
}

// ---------- Earning speed ----------

export type Boost = { startDate: string; endDate: string; earnPercent: number; active?: boolean };

/** The fastest boost running on this date (YYYY-MM-DD), as a percent; 100 when none. */
export function boostPercent(boosts: Boost[], today: string): number {
  let best = 100;
  for (const b of boosts) {
    if (b.active === false) continue;
    if (b.startDate <= today && today <= b.endDate && b.earnPercent > best) best = b.earnPercent;
  }
  return best;
}

/** Tier speed and a bonus day multiply (a Gold member on double points earns 2.5 times at 125%). Never more than 10 times normal. */
export function combinedPercent(...percents: number[]): number {
  const total = percents.reduce((acc, p) => acc.mul(p).div(100), new Decimal(100));
  return Math.min(total.round().toNumber(), 1000);
}

/** Points a sale earns at a speed: whole points on what was paid after discounts, before tax. 100% matches pointsFor. */
export function pointsAtSpeed(paidBeforeTax: Decimal.Value, pointsPerDollar: number, percent: number): number {
  const paid = new Decimal(paidBeforeTax);
  if (paid.lte(0) || pointsPerDollar <= 0 || percent <= 0) return 0;
  return paid.mul(pointsPerDollar).mul(percent).div(100).floor().toNumber();
}

export function cleanBoost(input: Record<string, unknown>, fail: (message: string) => never): { name: string; startDate: string; endDate: string; earnPercent: number } {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) fail("Give the bonus days a name, for example Double points weekend.");
  const date = (key: string, label: string) => {
    const v = String(input[key] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) fail(`${label}: pick a date.`);
    return v;
  };
  const startDate = date("startDate", "Start date");
  const endDate = date("endDate", "End date");
  if (endDate < startDate) fail("The end date is before the start date.");
  const raw = String(input.earnPercent ?? "").trim().replace(/%$/, "");
  if (!/^\d+$/.test(raw) || Number(raw) < 101 || Number(raw) > 500) fail("Points speed: type a percent from 101 to 500, like 200 for double points.");
  return { name, startDate, endDate, earnPercent: Number(raw) };
}

// ---------- Messaging windows ----------

/** Whether a local time (HH:MM) falls in the quiet hours, which may run past midnight (21:00 to 08:00). */
export function isQuietTime(localTime: string, quietStart: string, quietEnd: string): boolean {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return localTime >= quietStart && localTime < quietEnd;
  return localTime >= quietStart || localTime < quietEnd;
}

/** HH:MM validity. */
export function cleanClock(input: unknown, label: string, fail: (message: string) => never): string {
  const v = String(input ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(`${label}: type a time like 21:00.`);
  return v;
}

// ---------- Templates ----------

export type MergeValues = { firstName: string; shop: string; points: number; cardLink: string; referralCode: string };

/** Fill {first_name}, {shop}, {points}, {card_link} and {referral_code}. Unknown {words} are left as typed. */
export function renderTemplate(text: string, v: MergeValues): string {
  return text
    .replaceAll("{first_name}", v.firstName)
    .replaceAll("{shop}", v.shop)
    .replaceAll("{points}", v.points.toLocaleString("en-US"))
    .replaceAll("{card_link}", v.cardLink)
    .replaceAll("{referral_code}", v.referralCode);
}

export const MERGE_FIELDS = ["{first_name}", "{shop}", "{points}", "{card_link}", "{referral_code}"] as const;

// ---------- Automations ----------

export type AutomationKind = "WELCOME" | "SECOND_VISIT" | "BIRTHDAY" | "WIN_BACK_30" | "WIN_BACK_60" | "WIN_BACK_90";

export const AUTOMATIONS: { kind: AutomationKind; label: string; when: string; subject: string; body: string }[] = [
  {
    kind: "WELCOME",
    label: "Welcome",
    when: "The day after a shopper joins.",
    subject: "Welcome to {shop}",
    body: "Hi {first_name}, thanks for joining {shop} rewards. You have {points} points. See your points and your card any time: {card_link}",
  },
  {
    kind: "SECOND_VISIT",
    label: "Second-visit nudge",
    when: "14 days after a first purchase, if they haven't been back.",
    subject: "{first_name}, we'd love to see you again",
    body: "Hi {first_name}, you have {points} points waiting at {shop}. Your card: {card_link}",
  },
  {
    kind: "BIRTHDAY",
    label: "Birthday",
    when: "On the first day of their birthday month.",
    subject: "Happy birthday month, {first_name}",
    body: "Happy birthday month, {first_name}! Buy anything at {shop} this month and your birthday bonus points are added automatically. Your card: {card_link}",
  },
  {
    kind: "WIN_BACK_30",
    label: "Win-back, 30 days",
    when: "30 days after their last purchase.",
    subject: "We miss you at {shop}",
    body: "Hi {first_name}, it's been a month. You have {points} points at {shop}. Your card: {card_link}",
  },
  {
    kind: "WIN_BACK_60",
    label: "Win-back, 60 days",
    when: "60 days after their last purchase.",
    subject: "{first_name}, your points are still here",
    body: "Hi {first_name}, your {points} points are still at {shop}. They expire after a long time away, so come see us. Your card: {card_link}",
  },
  {
    kind: "WIN_BACK_90",
    label: "Win-back, 90 days",
    when: "90 days after their last purchase.",
    subject: "It's been a while, {first_name}",
    body: "Hi {first_name}, we haven't seen you in a while. {shop} would love to have you back. Your card: {card_link}",
  },
];

export const automationInfo = (kind: string) => AUTOMATIONS.find((a) => a.kind === kind);

// ---------- Brand-funded promotions ----------

/** What a brand owes for a promotion: its share of the discount dollars given. */
export function brandOwes(discountGiven: Decimal.Value, fundedPercent: number): string {
  return new Decimal(discountGiven).mul(fundedPercent).div(100).toFixed(2);
}

// ---------- Referral codes ----------

/** No 0, O, 1, I or L, so a code read aloud at the counter isn't mistyped. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function codeFromBytes(bytes: Uint8Array, length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function normalizeCode(input: unknown): string {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A plain email check: one @, a dot after it, no spaces. Not a promise the address works. */
export function normalizeEmail(input: unknown): string | null {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v) return "" as string;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 120 ? v : null;
}

/** Tags: short lowercase words, no duplicates, at most 12. */
export function cleanTags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map(String) : String(input ?? "").split(",");
  const seen = new Set<string>();
  for (const t of raw) {
    const tag = t.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 24);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 12);
}
