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
  return roundQty(q);
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
