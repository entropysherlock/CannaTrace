import Decimal from "decimal.js";

/**
 * Automatic promotions ("Wax Wednesdays", "20% off edibles this weekend", "$5 off every pre-roll").
 *
 * Rules the engine keeps no matter what a manager types:
 *  - a promotion only ever takes money off a price. Nothing is ever free: a line keeps at least 10% of its
 *    price, because New Mexico does not allow giving cannabis away (16.8.2.40(J) NMAC, CCD notice of Nov 2023).
 *  - when several promotions fit one line, the single best one applies. They do not pile on top of each other.
 */

export const MAX_PROMO_PERCENT = 90;

export type PromoKind = "PERCENT" | "DOLLAR";
export type PromoScope = "ALL" | "CATEGORY" | "ITEM";

export type Promo = {
  id: string;
  name: string;
  kind: PromoKind;
  /** Percent (1-90) or dollars off each unit. */
  amount: Decimal.Value;
  scope: PromoScope;
  categoryId?: string | null;
  itemId?: string | null;
  /** Days of the week it runs, 0 = Sunday ... 6 = Saturday. Empty means every day. */
  weekdays: number[];
  /** "HH:MM" 24-hour store time. Both empty means all day. */
  startTime?: string | null;
  endTime?: string | null;
  /** "YYYY-MM-DD" store dates, inclusive. */
  startDate?: string | null;
  endDate?: string | null;
  active: boolean;
};

export type PromoLine = {
  id: string;
  itemId: string;
  categoryId: string;
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
};

/** What time it is in the store: weekday 0-6, minutes since midnight, and the date. */
export type StoreClock = { weekday: number; minutes: number; date: string };

export type PromoResult = {
  total: Decimal;
  /** Dollars off per cart line id (only lines that got something). */
  byLine: Map<string, { amount: Decimal; promoId: string; promoName: string }>;
  /** Names of the promotions that took money off, each once. */
  names: string[];
};

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function parseClock(text: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((text ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** Whether the promotion is running right now at the store. */
export function isRunning(p: Promo, clock: StoreClock): boolean {
  if (!p.active) return false;
  if (p.weekdays.length > 0 && !p.weekdays.includes(clock.weekday))
    return false;
  if (p.startDate && clock.date < p.startDate) return false;
  if (p.endDate && clock.date > p.endDate) return false;
  const from = parseClock(p.startTime);
  const to = parseClock(p.endTime);
  if (from !== null && to !== null) {
    // A window past midnight (8pm to 2am) runs from the start time to the end of the day, and from midnight to the end time.
    return from <= to
      ? clock.minutes >= from && clock.minutes < to
      : clock.minutes >= from || clock.minutes < to;
  }
  if (from !== null) return clock.minutes >= from;
  if (to !== null) return clock.minutes < to;
  return true;
}

export function appliesToLine(p: Promo, line: PromoLine): boolean {
  if (p.scope === "ALL") return true;
  if (p.scope === "CATEGORY")
    return !!p.categoryId && p.categoryId === line.categoryId;
  return !!p.itemId && p.itemId === line.itemId;
}

/** Dollars one promotion takes off one line, never more than 90% of the line. */
export function lineDiscount(p: Promo, line: PromoLine): Decimal {
  const lineTotal = round2(new Decimal(line.quantity).mul(line.unitPrice));
  if (lineTotal.lte(0)) return new Decimal(0);
  const raw =
    p.kind === "PERCENT"
      ? round2(
          lineTotal
            .mul(Decimal.min(new Decimal(p.amount), MAX_PROMO_PERCENT))
            .div(100),
        )
      : round2(new Decimal(p.amount).mul(line.quantity));
  const cap = round2(lineTotal.mul(MAX_PROMO_PERCENT).div(100));
  return Decimal.max(0, Decimal.min(raw, cap));
}

export function applyPromotions(
  lines: PromoLine[],
  promos: Promo[],
  clock: StoreClock,
): PromoResult {
  const running = promos.filter((p) => isRunning(p, clock));
  const byLine: PromoResult["byLine"] = new Map();
  const names: string[] = [];
  let total = new Decimal(0);
  for (const line of lines) {
    let best: { amount: Decimal; promo: Promo } | null = null;
    for (const p of running) {
      if (!appliesToLine(p, line)) continue;
      const amount = lineDiscount(p, line);
      if (amount.gt(0) && (!best || amount.gt(best.amount)))
        best = { amount, promo: p };
    }
    if (!best) continue;
    byLine.set(line.id, {
      amount: best.amount,
      promoId: best.promo.id,
      promoName: best.promo.name,
    });
    total = total.add(best.amount);
    if (!names.includes(best.promo.name)) names.push(best.promo.name);
  }
  return { total, byLine, names };
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** "Wednesdays 4:20 PM to close, 20% off", for the list and the cart. */
export function describePromo(
  p: Pick<
    Promo,
    | "kind"
    | "amount"
    | "weekdays"
    | "startTime"
    | "endTime"
    | "startDate"
    | "endDate"
  >,
): string {
  const amount =
    p.kind === "PERCENT"
      ? `${new Decimal(p.amount).toString()}% off`
      : `$${new Decimal(p.amount).toFixed(2)} off each`;
  const days =
    p.weekdays.length === 0 || p.weekdays.length === 7
      ? "Every day"
      : [...p.weekdays]
          .sort()
          .map((d) => `${WEEKDAY_NAMES[d].slice(0, 3)}`)
          .join(", ");
  const hm = (t: string) => {
    const m = parseClock(t);
    if (m === null) return t;
    const h = Math.floor(m / 60);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const hours =
    p.startTime && p.endTime
      ? `${hm(p.startTime)} to ${hm(p.endTime)}`
      : p.startTime
        ? `from ${hm(p.startTime)}`
        : p.endTime
          ? `until ${hm(p.endTime)}`
          : "";
  const dates =
    p.startDate && p.endDate
      ? `${p.startDate} to ${p.endDate}`
      : p.startDate
        ? `from ${p.startDate}`
        : p.endDate
          ? `through ${p.endDate}`
          : "";
  return [amount, days, hours, dates].filter(Boolean).join(" · ");
}
