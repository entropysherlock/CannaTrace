import Decimal from "decimal.js";
import { InventoryError } from "./inventory-math";
import { convert, dimensionOf, roundQty, type UnitCode } from "./units";

/** How many times a recipe is being made. Half batches are allowed. */
export function parseBatches(input: unknown): Decimal {
  let value: Decimal;
  try {
    value = new Decimal(String(input ?? "").trim());
  } catch {
    throw new InventoryError("Number of batches must be a number, for example 1 or 2.5.");
  }
  if (!value.isFinite() || value.lte(0)) throw new InventoryError("Number of batches must be greater than zero.");
  if (value.gt(10000)) throw new InventoryError("That is too many batches for one run.");
  return value;
}

/** What a run needs of each input, and what it should make. */
export function scaleRecipe(
  recipe: { outputQuantity: Decimal.Value; lines: { itemId: string; quantity: Decimal.Value }[] },
  batches: Decimal,
): { plannedOutput: Decimal; needs: Map<string, Decimal> } {
  return {
    plannedOutput: roundQty(new Decimal(recipe.outputQuantity).mul(batches)),
    needs: new Map(recipe.lines.map((line) => [line.itemId, roundQty(new Decimal(line.quantity).mul(batches))])),
  };
}

/**
 * Total cost of what went in. If any input has no cost on record the total is unknown,
 * because a partial total would look like a real (and too low) number.
 */
export function inputCost(inputs: { quantity: Decimal.Value; costPerUnit: Decimal.Value | null }[]): Decimal | null {
  let total = new Decimal(0);
  for (const input of inputs) {
    if (input.costPerUnit === null) return null;
    total = total.add(new Decimal(input.quantity).mul(input.costPerUnit));
  }
  return roundQty(total);
}

export function unitCost(total: Decimal | null, extra: Decimal, output: Decimal): Decimal | null {
  if (total === null || output.lte(0)) return null;
  return roundQty(total.add(extra).div(output));
}

/** Actual output as a percentage of planned output, to one decimal place. */
export function yieldPercent(actual: Decimal.Value, planned: Decimal.Value): Decimal | null {
  const plan = new Decimal(planned);
  if (plan.lte(0)) return null;
  return new Decimal(actual).div(plan).mul(100).toDecimalPlaces(1);
}

/**
 * Weight lost in the run, in grams: weight in minus weight out. Only meaningful when
 * every input and the output are measured by weight; otherwise null.
 */
export function weightLoss(
  inputs: { quantity: Decimal.Value; unit: UnitCode }[],
  output: { quantity: Decimal.Value; unit: UnitCode },
): Decimal | null {
  if (dimensionOf(output.unit) !== "WEIGHT" || inputs.some((i) => dimensionOf(i.unit) !== "WEIGHT")) return null;
  const weightIn = inputs.reduce((sum, i) => sum.add(convert(i.quantity, i.unit, "G")), new Decimal(0));
  return roundQty(weightIn.sub(convert(output.quantity, output.unit, "G")));
}

export type RunSummaryInput = {
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  plannedOutput: Decimal.Value;
  actualOutput: Decimal.Value | null;
  inputCost: Decimal.Value | null;
  extraCost: Decimal.Value | null;
  completedAt: Date | null;
};

/**
 * The numbers across the top of Manufacturing: runs in progress, runs finished this month,
 * the average yield of runs finished in the last 90 days, and what this month's runs cost.
 * Cost is null when no run finished this month has a known cost.
 */
export function summarizeRuns(runs: RunSummaryInput[], now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const done = runs.filter((r) => r.status === "COMPLETED" && r.completedAt && r.actualOutput !== null);
  const thisMonth = done.filter((r) => r.completedAt! >= monthStart);
  const yields = done
    .filter((r) => r.completedAt! >= since90)
    .map((r) => yieldPercent(r.actualOutput!, r.plannedOutput))
    .filter((y): y is Decimal => y !== null);
  const costed = thisMonth.filter((r) => r.inputCost !== null);
  return {
    inProgress: runs.filter((r) => r.status === "IN_PROGRESS").length,
    completedThisMonth: thisMonth.length,
    averageYield: yields.length ? yields.reduce((a, b) => a.add(b), new Decimal(0)).div(yields.length).toDecimalPlaces(1) : null,
    yieldRuns: yields.length,
    costThisMonth: costed.length ? costed.reduce((a, r) => a.add(r.inputCost!).add(r.extraCost ?? 0), new Decimal(0)).toDecimalPlaces(2) : null,
  };
}

/** A suggested name for the next run: RUN-20261118-01, -02, … counting runs already named that day. */
export function suggestRunName(existing: string[], now = new Date(), timeZone = "America/Denver"): string {
  // The date in Mountain time, where New Mexico facilities are, not the server's time zone.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now).replace(/-/g, "");
  const prefix = `RUN-${day}-`;
  const taken = new Set(existing.map((n) => n.toUpperCase()));
  let n = 1;
  while (taken.has(`${prefix}${String(n).padStart(2, "0")}`)) n++;
  return `${prefix}${String(n).padStart(2, "0")}`;
}
