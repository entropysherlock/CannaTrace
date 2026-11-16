import Decimal from "decimal.js";
import { InventoryError, normalizeTag, parsePositiveQty } from "./inventory-math";
import { convert, dimensionOf, roundQty, type UnitCode } from "./units";

export const MAX_PLANTS_PER_ACTION = 500;

/**
 * Build a run of consecutive tags from the first one, the way tag rolls are printed:
 * PL-0098 with a count of 3 gives PL-0098, PL-0099, PL-0100.
 */
export function expandTags(firstTag: unknown, count: number): string[] {
  const first = normalizeTag(firstTag);
  if (!Number.isInteger(count) || count < 1) throw new InventoryError("Enter how many plants to tag (at least 1).");
  if (count > MAX_PLANTS_PER_ACTION) {
    throw new InventoryError(`Tag at most ${MAX_PLANTS_PER_ACTION} plants at a time.`);
  }
  const match = first.match(/^(.*?)(\d+)$/);
  if (!match) {
    if (count === 1) return [first];
    throw new InventoryError("The first tag must end in a number so the rest can be counted up from it.");
  }
  const [, prefix, digits] = match;
  const start = BigInt(digits);
  const tags: string[] = [];
  for (let i = 0; i < count; i++) {
    const number = (start + BigInt(i)).toString().padStart(digits.length, "0");
    if (number.length > digits.length) {
      throw new InventoryError(`The tag numbers run out after ${prefix}${"9".repeat(digits.length)}. Start a new tag series.`);
    }
    tags.push(`${prefix}${number}`);
  }
  return tags;
}

/** Tags typed or scanned one per line (or separated by spaces or commas). */
export function parseTagList(raw: string): string[] {
  const tags = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((tag) => normalizeTag(tag));
  if (tags.length === 0) throw new InventoryError("Scan or type at least one tag.");
  if (tags.length > MAX_PLANTS_PER_ACTION) throw new InventoryError(`Tag at most ${MAX_PLANTS_PER_ACTION} plants at a time.`);
  const seen = new Set<string>();
  for (const tag of tags) {
    if (seen.has(tag)) throw new InventoryError(`Tag ${tag} is listed twice.`);
    seen.add(tag);
  }
  return tags;
}

/** Turn a weight typed in any weight unit into grams. */
export function toGrams(quantity: unknown, unit: string, what = "Weight"): Decimal {
  const value = parsePositiveQty(quantity, what);
  if (!["MG", "G", "KG", "OZ", "LB"].includes(unit) || dimensionOf(unit as UnitCode) !== "WEIGHT") {
    throw new InventoryError("Choose a weight unit.");
  }
  const grams = roundQty(convert(value, unit as UnitCode, "G"));
  if (grams.lte(0)) throw new InventoryError(`${what} is too small to record.`);
  return grams;
}

/** What is physically left of a harvest: the latest weight minus waste and what has been packaged. */
export function harvestOnHand(harvest: {
  wetWeight: Decimal.Value;
  dryWeight: Decimal.Value | null;
  wasteWeight: Decimal.Value;
  packagedWeight: Decimal.Value;
}): Decimal {
  return new Decimal(harvest.dryWeight ?? harvest.wetWeight).sub(harvest.wasteWeight).sub(harvest.packagedWeight);
}

/** Take weight out of a harvest (waste or packaging), refusing to go below zero. */
export function takeFromHarvest(onHand: Decimal, grams: Decimal, what: string): Decimal {
  if (grams.gt(onHand)) {
    throw new InventoryError(
      `${what} is ${grams.toString()} g but only ${onHand.toString()} g of this harvest is left.`,
    );
  }
  return onHand.sub(grams);
}
