/** Maintenance and calibration schedules. Dates are YYYY-MM-DD in the facility's own time. */

export type DueState = "none" | "ok" | "soon" | "overdue";
/** How many days ahead counts as "due soon". */
export const SOON_DAYS = 14;

const toDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const DAY = 86_400_000;

export function addDays(iso: string, days: number): string {
  return new Date(toDay(iso) + days * DAY).toISOString().slice(0, 10);
}

/**
 * When the next job is due, and where that stands today. No schedule means "none". A schedule that
 * has never been done is due as of the day the equipment was added (`since`), so new equipment with a
 * schedule shows up as due rather than silently fine.
 */
export function dueStatus(input: { everyDays: number | null; lastOn: string | null; since: string; today: string }): { state: DueState; nextDue: string | null; daysLeft: number | null } {
  if (!input.everyDays || input.everyDays <= 0) return { state: "none", nextDue: null, daysLeft: null };
  const nextDue = addDays(input.lastOn ?? input.since, input.everyDays);
  const daysLeft = Math.round((toDay(nextDue) - toDay(input.today)) / DAY);
  return { state: daysLeft < 0 ? "overdue" : daysLeft <= SOON_DAYS ? "soon" : "ok", nextDue, daysLeft };
}

/** The worse of two states, for one badge covering both maintenance and calibration. */
export function worst(a: DueState, b: DueState): DueState {
  const rank: Record<DueState, number> = { none: 0, ok: 1, soon: 2, overdue: 3 };
  return rank[a] >= rank[b] ? a : b;
}

/** A schedule typed by a person: a whole number of days between 1 and 3650, or blank for none. */
export function parseEveryDays(raw: unknown, label: string): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a whole number of days, for example 90.`);
  const n = Number(text);
  if (n < 1 || n > 3650) throw new Error(`${label} must be between 1 and 3650 days.`);
  return n;
}
