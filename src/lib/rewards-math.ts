import Decimal from "decimal.js";

/**
 * Rewards math, kept free of the database so every rule can be tested on its own.
 *
 * The program: shoppers earn points on what they pay (after discounts, before tax) and spend them as
 * whole rewards, each worth a fixed number of dollars off. New Mexico forbids giving cannabis away
 * (16.8.2 NMAC), so a reward is spread across the whole cart and may never pay for more than a set share
 * of it. With the default 50%, every item still costs at least half its price.
 */

export type RewardProgram = {
  enabled: boolean;
  pointsPerDollar: number;
  redeemPoints: number;
  redeemDollars: string;
  signupBonus: number;
  birthdayBonus: number;
  expireMonths: number;
  maxSharePercent: number;
};

/** What a new business starts with: the industry standard of 1 point per $1 and 100 points = $5 off. */
export const DEFAULT_PROGRAM: RewardProgram = {
  enabled: false,
  pointsPerDollar: 1,
  redeemPoints: 100,
  redeemDollars: "5.00",
  signupBonus: 25,
  birthdayBonus: 50,
  expireMonths: 12,
  maxSharePercent: 50,
};

/** Hard ceiling on the share of a cart rewards may cover, whatever a store sets: a reward must never make cannabis free. */
export const MAX_SHARE_CEILING = 90;

/**
 * How many rewards actually apply to a cart: as many of the wanted ones as fit under the cap, and always
 * leaving something to pay. `afterDiscount` is the cart after any percent discount, before tax.
 */
export function rewardsThatFit(wanted: number, afterDiscount: Decimal.Value, program: Pick<RewardProgram, "redeemDollars" | "maxSharePercent">): number {
  const each = new Decimal(program.redeemDollars);
  const base = new Decimal(afterDiscount);
  if (wanted <= 0 || each.lte(0) || base.lte(0)) return 0;
  const share = Math.min(Math.max(program.maxSharePercent, 0), MAX_SHARE_CEILING);
  const cap = base.mul(share).div(100);
  let fit = Math.min(wanted, cap.div(each).floor().toNumber());
  // Never the whole cart, even if a share setting and the prices happen to line up exactly.
  while (fit > 0 && each.mul(fit).gte(base)) fit--;
  return Math.max(fit, 0);
}

/** The most rewards a shopper could use on this cart right now: limited by their points and by the cap. */
export function rewardsAvailable(points: number, afterDiscount: Decimal.Value, program: Pick<RewardProgram, "redeemPoints" | "redeemDollars" | "maxSharePercent">): number {
  if (program.redeemPoints <= 0) return 0;
  return rewardsThatFit(Math.floor(points / program.redeemPoints), afterDiscount, program);
}

/** Points a sale earns: whole points on what was paid after every discount, before tax. */
export function pointsFor(paidBeforeTax: Decimal.Value, pointsPerDollar: number): number {
  const paid = new Decimal(paidBeforeTax);
  if (paid.lte(0) || pointsPerDollar <= 0) return 0;
  return paid.mul(pointsPerDollar).floor().toNumber();
}

/**
 * Points to take back for a refund: the same share of the earned points as the refund is of the sale.
 * The last refund takes back whatever is left, so the totals always line up.
 */
export function pointsToTakeBack(earned: number, alreadyTaken: number, refund: Decimal.Value, saleTotal: Decimal.Value, finalReturn: boolean): number {
  const left = Math.max(earned - alreadyTaken, 0);
  if (finalReturn) return left;
  const total = new Decimal(saleTotal);
  if (total.lte(0)) return 0;
  return Math.min(left, new Decimal(earned).mul(refund).div(total).floor().toNumber());
}

/** US phone numbers only: 10 digits, with or without punctuation or a leading 1. */
export function normalizePhone(input: unknown): string | null {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10 || digits.startsWith("0") || digits.startsWith("1")) return null;
  return digits;
}

/** (505) 555-1234 */
export function formatPhone(digits: string): string {
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

/** The last four only, for screens a customer might see: ••• 1234 */
export function maskPhone(digits: string): string {
  return `••• ${digits.slice(-4)}`;
}

/**
 * A birthday as month and day ("MM-DD"), from "3/14", "03-14", "March 14" style input or a full date. The year is
 * dropped: the program only needs to know the month. Empty input means no birthday; anything else unreadable is null.
 */
export function parseBirthday(input: unknown): string | null | "none" {
  const raw = String(input ?? "").trim();
  if (!raw) return "none";
  let month: number | undefined;
  let day: number | undefined;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const md = raw.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*\d{2,4})?$/);
  if (iso) [month, day] = [Number(iso[2]), Number(iso[3])];
  else if (md) [month, day] = [Number(md[1]), Number(md[2])];
  else {
    const named = raw.match(/^([a-z]+)\.?\s+(\d{1,2})$/i);
    if (named) {
      const m = MONTHS.findIndex((name) => name.startsWith(named[1].toLowerCase().slice(0, 3)));
      if (m >= 0) [month, day] = [m + 1, Number(named[2])];
    }
  }
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > DAYS_IN[month - 1]) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "March 14" */
export function formatBirthday(mmdd: string | null): string {
  if (!mmdd) return "";
  const [m, d] = mmdd.split("-").map(Number);
  const name = MONTHS[m - 1];
  return name ? `${name[0].toUpperCase()}${name.slice(1)} ${d}` : "";
}

/** Whether today (YYYY-MM-DD, store's own date) is in the shopper's birthday month. */
export function isBirthdayMonth(birthday: string | null, today: string): boolean {
  return Boolean(birthday) && birthday!.slice(0, 2) === today.slice(5, 7);
}

/** Whether points have run out: no activity for the program's number of months (0 = never). */
export function pointsExpired(lastActivity: Date, now: Date, expireMonths: number): boolean {
  if (expireMonths <= 0) return false;
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - expireMonths);
  return lastActivity < cutoff;
}

/** Check and clean a store's program settings. Throws a plain-English message for the first problem. */
export function cleanProgram(input: Record<string, unknown>, fail: (message: string) => never): RewardProgram {
  const whole = (key: string, label: string, min: number, max: number) => {
    const raw = String(input[key] ?? "").trim();
    if (!/^\d+$/.test(raw)) fail(`${label}: type a whole number, for example ${min === 0 ? 0 : min}.`);
    const n = Number(raw);
    if (n < min || n > max) fail(`${label} must be between ${min} and ${max}.`);
    return n;
  };
  const dollarsRaw = String(input.redeemDollars ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(dollarsRaw) || Number(dollarsRaw) <= 0 || Number(dollarsRaw) > 500)
    fail("Each reward's value: type a dollar amount like 5 or 5.00 (up to $500).");
  return {
    enabled: input.enabled === true || input.enabled === "on" || input.enabled === "true",
    pointsPerDollar: whole("pointsPerDollar", "Points per $1", 1, 100),
    redeemPoints: whole("redeemPoints", "Points for one reward", 1, 100000),
    redeemDollars: new Decimal(dollarsRaw).toFixed(2),
    signupBonus: whole("signupBonus", "Sign-up bonus", 0, 10000),
    birthdayBonus: whole("birthdayBonus", "Birthday bonus", 0, 10000),
    expireMonths: whole("expireMonths", "Points expire after (months)", 0, 60),
    maxSharePercent: whole("maxSharePercent", "Most of a cart rewards can pay for (%)", 1, MAX_SHARE_CEILING),
  };
}

/** What the program gives back, as a share of spending: e.g. 1 pt per $1 and 100 pts = $5 is 5%. */
export function giveBackPercent(program: Pick<RewardProgram, "pointsPerDollar" | "redeemPoints" | "redeemDollars">): string {
  if (program.redeemPoints <= 0) return "0";
  return new Decimal(program.redeemDollars).mul(program.pointsPerDollar).div(program.redeemPoints).mul(100).toDecimalPlaces(1).toString();
}
