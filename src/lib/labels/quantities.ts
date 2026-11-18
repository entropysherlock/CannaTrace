import Decimal from "decimal.js";
import { convert, dimensionOf, type UnitCode } from "@/lib/units";

/**
 * Quantities and potency worked out for labels. Pure functions, so they're easy to test.
 * New Mexico wants net quantity in both metric and U.S. units (16.8.3.9(K)(2) NMAC)
 * and lets potency under 1 mg read "<1 mg" (16.8.3.9(G) NMAC).
 */

const GRAMS_PER_OZ = new Decimal("28.349523125");
const ML_PER_FL_OZ = new Decimal("29.5735295625");

/** Up to `dp` decimal places, without trailing zeros: 3.50 → "3.5". */
export function trim(value: Decimal.Value, dp = 2): string {
  return new Decimal(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toString();
}

export type Net = { metric: string; us: string; both: string; grams: Decimal | null };

function weight(grams: Decimal): Net {
  const metric = grams.gte(1000) ? `${trim(grams.div(1000), 3)} kg` : grams.lt(1) ? `${trim(grams.times(1000), 1)} mg` : `${trim(grams)} g`;
  const oz = grams.div(GRAMS_PER_OZ);
  const us = oz.gte(16) ? `${trim(oz.div(16), 2)} lb` : `${trim(oz, oz.lt(0.1) ? 3 : 2)} oz`;
  return { metric, us, both: `${metric} (${us})`, grams };
}

function volume(ml: Decimal): Net {
  const metric = ml.gte(1000) ? `${trim(ml.div(1000), 3)} L` : `${trim(ml, 1)} mL`;
  const us = `${trim(ml.div(ML_PER_FL_OZ), 2)} fl oz`;
  return { metric, us, both: `${metric} (${us})`, grams: null };
}

/**
 * Net quantity of a package. Weight and volume convert directly. Items counted "each" need the
 * item's unit weight; without it there is nothing honest to print, so the result is null.
 */
export function netQuantity(quantity: Decimal.Value, unit: UnitCode, unitWeightGrams: Decimal.Value | null | undefined): Net | null {
  const q = new Decimal(quantity);
  if (q.lte(0)) return null;
  const dim = dimensionOf(unit);
  if (dim === "WEIGHT") return weight(convert(q, unit, "G"));
  if (dim === "VOLUME") return volume(convert(q, unit, "ML"));
  if (unitWeightGrams === null || unitWeightGrams === undefined || unitWeightGrams === "") return null;
  const each = new Decimal(unitWeightGrams);
  if (each.lte(0)) return null;
  return weight(each.times(q));
}

/** "12.5 mg", or "<1 mg" below one milligram, as New Mexico allows. */
export function mg(value: Decimal.Value | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const v = new Decimal(value);
  if (v.lt(0)) return null;
  if (v.lt(1)) return "<1 mg";
  return `${trim(v, v.gte(100) ? 0 : 1)} mg`;
}

/** Milligrams of a cannabinoid in a package: lab percent × grams × 10. Null without both numbers. */
export function mgInPackage(percent: Decimal.Value | null | undefined, grams: Decimal | null): Decimal | null {
  if (percent === null || percent === undefined || percent === "" || !grams) return null;
  return new Decimal(percent).times(grams).times(10);
}

/**
 * Per-package dose for products sold by the serving: servings × mg per serving × units in the package.
 * New Mexico: when a serving is under 1 mg, state the container total the same way ("<5 mg" for five servings).
 */
export function mgPerPackage(mgPerServing: Decimal.Value | null | undefined, servings: number | null | undefined, units: Decimal.Value): string | null {
  if (mgPerServing === null || mgPerServing === undefined || mgPerServing === "" || !servings || servings <= 0) return null;
  const per = new Decimal(mgPerServing);
  const totalServings = new Decimal(servings).times(units);
  if (per.lt(1)) return `<${trim(totalServings, 0)} mg`;
  return mg(per.times(totalServings));
}

/** "THCa 23.9% · Δ9-THC 0.4% · CBG 1.1%": every value the lab reported, in a fixed order, skipping blanks. */
export function profileLine(values: [string, Decimal.Value | null | undefined][]): string | null {
  const parts = values.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([name, v]) => `${name} ${trim(v!, 3)}%`);
  return parts.length ? parts.join(" · ") : null;
}

export function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
