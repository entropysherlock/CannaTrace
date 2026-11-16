import Decimal from "decimal.js";
import { InventoryError } from "./inventory-math";

export const PAYMENT_METHODS = ["CASH", "CHECK", "ACH", "WIRE", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const round2 = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** A dollar amount typed by a person: optional $ and commas, at most two decimal places. */
export function parseMoney(input: unknown, what = "Amount", options: { allowZero?: boolean } = {}): Decimal {
  const text = String(input ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new InventoryError(`${what} must be a dollar amount such as 125 or 125.50.`);
  }
  const value = new Decimal(text);
  if (value.isZero() && !options.allowZero) throw new InventoryError(`${what} must be more than zero.`);
  return value;
}

/** A price per unit can carry up to four decimal places (for example $0.0825 per gram). */
export function parsePrice(input: unknown, what = "Price"): Decimal {
  const text = String(input ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(text)) throw new InventoryError(`${what} must be a dollar amount such as 4.50.`);
  return new Decimal(text);
}

export function lineTotal(quantity: Decimal.Value, unitPrice: Decimal.Value): Decimal {
  return round2(new Decimal(quantity).mul(unitPrice));
}

export function orderTotal(lines: { quantity: Decimal.Value; unitPrice: Decimal.Value }[]): Decimal {
  return lines.reduce((sum, line) => sum.add(lineTotal(line.quantity, line.unitPrice)), new Decimal(0));
}

export type InvoiceState = "OPEN" | "PARTIAL" | "PAID";

export function invoiceBalance(total: Decimal.Value, paid: Decimal.Value[]): { paid: Decimal; balance: Decimal; state: InvoiceState } {
  const sum = paid.reduce<Decimal>((acc, p) => acc.add(p), new Decimal(0));
  const balance = new Decimal(total).sub(sum);
  return { paid: sum, balance, state: balance.lte(0) ? "PAID" : sum.gt(0) ? "PARTIAL" : "OPEN" };
}

/** Today's date as YYYY-MM-DD in the facility's working time zone. */
export function todayIn(timeZone = "America/Denver", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function parseDate(input: unknown, what: string): string {
  const text = String(input ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])) return text;
  }
  throw new InventoryError(`${what} must be a real date.`);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Why a customer cannot be sold to right now, or null when they can. */
export function licenseProblem(
  customer: { name: string; active: boolean; licenseExpires: string; licenseVerifiedAt: Date | null },
  today: string,
): string | null {
  if (!customer.active) return `${customer.name} is marked inactive.`;
  if (!customer.licenseVerifiedAt) return `${customer.name}'s license has not been verified yet. Verify it on the customer's page.`;
  if (customer.licenseExpires < today) return `${customer.name}'s license expired on ${customer.licenseExpires}. Update it before selling to them.`;
  return null;
}

export function formatNumber(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(5, "0")}`;
}
