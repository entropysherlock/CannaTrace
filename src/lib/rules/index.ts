import Decimal from "decimal.js";
import { CA } from "./packs/ca";
import { CO } from "./packs/co";
import { MI } from "./packs/mi";
import { NM } from "./packs/nm";
import type { Rule, StatePack } from "./types";

export type { Rule, StatePack } from "./types";
export { ENFORCEMENT } from "./types";

/** Every state with a rule pack. Add a state by writing its pack and listing it here. */
export const PACKS: Record<string, StatePack> = { NM, CA, MI, CO };

export function packFor(state: string | null | undefined): StatePack | null {
  return state ? (PACKS[state.toUpperCase()] ?? null) : null;
}

export function rulesOf<K extends Rule["kind"]>(pack: StatePack | null, kind: K): Extract<Rule, { kind: K }>[] {
  return (pack?.rules.filter((r) => r.kind === kind) ?? []) as Extract<Rule, { kind: K }>[];
}

export type LimitMap = { FLOWER: Decimal; CONCENTRATE: Decimal; EDIBLE: Decimal };

/** The state's per-purchase caps for this kind of customer (only the categories it caps). */
export function stateLimits(pack: StatePack | null, customer: "ADULT_USE" | "MEDICAL"): Partial<LimitMap> {
  const rule = rulesOf(pack, "PURCHASE_LIMIT").find((r) => r.customer === customer);
  const out: Partial<LimitMap> = {};
  if (rule?.flowerGrams !== undefined) out.FLOWER = new Decimal(rule.flowerGrams);
  if (rule?.concentrateGrams !== undefined) out.CONCENTRATE = new Decimal(rule.concentrateGrams);
  if (rule?.edibleMg !== undefined) out.EDIBLE = new Decimal(rule.edibleMg);
  return out;
}

/**
 * The limits the register actually applies: the store's own, or the state's when the state's is lower.
 * `fromState` lists the categories where the state's number won, so messages can say so.
 */
export function effectiveLimits(store: LimitMap, pack: StatePack | null, customer: "ADULT_USE" | "MEDICAL") {
  const state = stateLimits(pack, customer);
  const limits = { ...store };
  const fromState = new Set<keyof LimitMap>();
  for (const key of ["FLOWER", "CONCENTRATE", "EDIBLE"] as const) {
    const cap = state[key];
    if (cap && cap.lt(store[key])) {
      limits[key] = cap;
      fromState.add(key);
    }
  }
  return { limits, fromState };
}

/** A cap on flower and concentrate grams together, where the state has one. */
export function combinedCap(pack: StatePack | null, customer: "ADULT_USE" | "MEDICAL"): Decimal | null {
  const rule = rulesOf(pack, "PURCHASE_LIMIT").find((r) => r.customer === customer);
  return rule?.combinedGrams !== undefined ? new Decimal(rule.combinedGrams) : null;
}

/** The youngest a customer may be, taking the stricter of the store's setting and the state's rule. */
export function minimumAge(storeAge: number, pack: StatePack | null, customer: "ADULT_USE" | "MEDICAL"): number {
  const rule = rulesOf(pack, "MIN_AGE").find((r) => r.customer === customer);
  return Math.max(storeAge, rule?.years ?? 0);
}

export const requiresLabBeforeRetail = (pack: StatePack | null) => rulesOf(pack, "LAB_TEST_BEFORE_RETAIL").length > 0;
export const wasteRule = (pack: StatePack | null) => rulesOf(pack, "WASTE")[0] ?? null;
