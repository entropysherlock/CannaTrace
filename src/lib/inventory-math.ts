import Decimal from "decimal.js";
import { roundQty } from "./units";


export class InventoryError extends Error {}

/** Parse user input into a positive quantity, with a clear message when it is not one. */
export function parsePositiveQty(input: unknown, what = "Quantity"): Decimal {
  let q: Decimal;
  try {
    q = new Decimal(String(input).trim());
  } catch {
    throw new InventoryError(`${what} must be a number, for example 12.5.`);
  }
  if (!q.isFinite() || q.lte(0)) throw new InventoryError(`${what} must be greater than zero.`);
  if (q.gt(MAX_QTY)) throw new InventoryError(`${what} is too large. Check the number and try again.`);
  return roundQty(q);
}

/** Bigger than any real package; keeps typos like 1e30 from reaching the database. */
export const MAX_QTY = new Decimal("1000000000000");

/** Items counted each (jars, pre-rolls, packs) only come in whole numbers. */
export function assertWholeForUnit(unit: string, quantity: Decimal.Value, what = "Quantity"): void {
  const q = new Decimal(quantity);
  if (unit === "EACH" && !q.isInteger()) {
    throw new InventoryError(`${what} must be a whole number for items counted each, for example ${q.floor().gt(0) ? q.floor().toString() : "1"}, not ${q.toString()}.`);
  }
}

/** Result of applying a change to a package quantity. Never lets stock go negative. */
export function applyDelta(
  before: Decimal.Value,
  delta: Decimal.Value,
): { before: Decimal; delta: Decimal; after: Decimal } {
  const b = roundQty(before);
  const d = roundQty(delta);
  const after = b.add(d);
  if (after.lt(0)) {
    throw new InventoryError(
      `Not enough stock: the package holds ${b.toString()} and this change would remove ${d.abs().toString()}.`,
    );
  }
  return { before: b, delta: d, after };
}

/** Split sizes must each be positive and together not exceed what the package holds. */
export function planSplit(
  available: Decimal.Value,
  parts: Decimal.Value[],
): { parts: Decimal[]; total: Decimal; remaining: Decimal } {
  if (parts.length === 0) throw new InventoryError("Add at least one new package to split into.");
  const rounded = parts.map((p) => parsePositiveQty(p, "Each split quantity"));
  const total = rounded.reduce((sum, p) => sum.add(p), new Decimal(0));
  const avail = roundQty(available);
  if (total.gt(avail)) {
    throw new InventoryError(
      `The split adds up to ${total.toString()} but the package only holds ${avail.toString()}.`,
    );
  }
  return { parts: rounded, total, remaining: avail.sub(total) };
}

/** Cost per unit of a merged package. Null when any source has no cost recorded. */
export function weightedAverageCost(
  sources: { quantity: Decimal.Value; costPerUnit: Decimal.Value | null }[],
): Decimal | null {
  let totalQty = new Decimal(0);
  let totalCost = new Decimal(0);
  for (const source of sources) {
    if (source.costPerUnit === null) return null;
    totalQty = totalQty.add(source.quantity);
    totalCost = totalCost.add(new Decimal(source.quantity).mul(source.costPerUnit));
  }
  if (totalQty.isZero()) return null;
  return roundQty(totalCost.div(totalQty));
}

/** Tags are upper-case letters, digits, dashes, dots, or underscores: safe to print as a barcode and to scan. */
export function normalizeTag(raw: unknown): string {
  const tag = String(raw ?? "").trim().toUpperCase();
  if (!tag) throw new InventoryError("Scan or type a package tag.");
  if (!/^[A-Z0-9][A-Z0-9._-]{2,39}$/.test(tag)) {
    throw new InventoryError(
      `"${tag.slice(0, 40)}" is not a valid tag. Use 3 to 40 letters, digits, dashes, dots, or underscores.`,
    );
  }
  return tag;
}

/** A package status as words that fit "Package X is ___": "on hold", "in quarantine", "finished". */
export function statusWords(status: string): string {
  if (status === "QUARANTINE") return "in quarantine";
  return status.replace(/_/g, " ").toLowerCase();
}
