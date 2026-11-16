import Decimal from "decimal.js";

export type UnitCode = "MG" | "G" | "KG" | "OZ" | "LB" | "ML" | "L" | "EACH";
export type Dimension = "WEIGHT" | "VOLUME" | "COUNT";


// Factor to the base unit of each dimension (grams, millilitres, each).
const UNITS: Record<UnitCode, { dimension: Dimension; toBase: string; label: string }> = {
  MG: { dimension: "WEIGHT", toBase: "0.001", label: "mg" },
  G: { dimension: "WEIGHT", toBase: "1", label: "g" },
  KG: { dimension: "WEIGHT", toBase: "1000", label: "kg" },
  OZ: { dimension: "WEIGHT", toBase: "28.349523125", label: "oz" },
  LB: { dimension: "WEIGHT", toBase: "453.59237", label: "lb" },
  ML: { dimension: "VOLUME", toBase: "1", label: "mL" },
  L: { dimension: "VOLUME", toBase: "1000", label: "L" },
  EACH: { dimension: "COUNT", toBase: "1", label: "ea" },
};

export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

export function dimensionOf(unit: UnitCode): Dimension {
  return UNITS[unit].dimension;
}

export function unitLabel(unit: UnitCode): string {
  return UNITS[unit].label;
}

export function canConvert(from: UnitCode, to: UnitCode): boolean {
  return dimensionOf(from) === dimensionOf(to);
}

/** Convert a quantity between units of the same dimension. Throws across dimensions. */
export function convert(
  quantity: Decimal.Value,
  from: UnitCode,
  to: UnitCode,
): Decimal {
  if (!canConvert(from, to)) {
    throw new Error(`Cannot convert ${unitLabel(from)} to ${unitLabel(to)}: different kinds of measure.`);
  }
  if (from === to) return new Decimal(quantity);
  return new Decimal(quantity).mul(UNITS[from].toBase).div(UNITS[to].toBase);
}

/** Quantities are stored to 4 decimal places. */
export function roundQty(quantity: Decimal.Value): Decimal {
  return new Decimal(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function formatQty(quantity: Decimal.Value, unit: UnitCode): string {
  const q = new Decimal(quantity);
  const text = q.toDecimalPlaces(4).toString();
  return `${text} ${unitLabel(unit)}`;
}
