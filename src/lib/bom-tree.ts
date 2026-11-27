import Decimal from "decimal.js";
import { InventoryError } from "./inventory-math";
import { roundQty } from "./units";

/**
 * Multi-stage recipes. A recipe line whose item is made by another recipe is an intermediate
 * (dried flower -> pre-roll cones -> boxed pre-rolls). Nothing is stored for this: the chain comes
 * from the recipes themselves. This module walks it, with no database and no network.
 */

export type ChainRecipe = {
  id: string;
  name: string;
  outputItemId: string;
  outputQuantity: Decimal.Value;
  lines: { itemId: string; quantity: Decimal.Value }[];
};

export type ChainStage = {
  recipeId: string;
  name: string;
  outputItemId: string;
  batches: Decimal;
  plannedOutput: Decimal;
  /** What this stage uses; fromStage marks inputs that an earlier stage makes. */
  inputs: { itemId: string; quantity: Decimal; fromStage: boolean }[];
};

export type ChainPlan = {
  /** Earliest stage first: run them in this order. */
  stages: ChainStage[];
  /** What must come from stock (not from another recipe), added up across every stage. */
  raw: { itemId: string; needed: Decimal; onHand: Decimal; short: Decimal }[];
  /** Intermediates already in stock that covered part or all of a stage. */
  usedFromStock: { itemId: string; quantity: Decimal }[];
};

/** Recipes that make each item. If several do, the first by name is used, so the choice is stable. */
function producers(recipes: ChainRecipe[]): Map<string, ChainRecipe> {
  const map = new Map<string, ChainRecipe>();
  for (const r of [...recipes].sort((a, b) => a.name.localeCompare(b.name))) if (!map.has(r.outputItemId)) map.set(r.outputItemId, r);
  return map;
}

/** The names of recipes forming a loop (A uses B's output, B uses A's), or null when there is none. */
export function findLoop(recipes: ChainRecipe[]): string[] | null {
  const byItem = producers(recipes);
  const state = new Map<string, 1 | 2>();
  const path: ChainRecipe[] = [];
  const visit = (r: ChainRecipe): string[] | null => {
    state.set(r.id, 1);
    path.push(r);
    for (const line of r.lines) {
      const next = byItem.get(line.itemId);
      if (!next) continue;
      if (state.get(next.id) === 1) return [...path.slice(path.indexOf(next)).map((p) => p.name), next.name];
      if (!state.has(next.id)) {
        const loop = visit(next);
        if (loop) return loop;
      }
    }
    path.pop();
    state.set(r.id, 2);
    return null;
  };
  for (const r of recipes) if (!state.has(r.id)) {
    const loop = visit(r);
    if (loop) return loop;
  }
  return null;
}

/**
 * Plan a multi-stage run. `batches` is how many batches of the final recipe. Each intermediate is
 * made only as far as stock does not already cover it (onHand), and the batches of an intermediate
 * are exact (they may be fractional, as batches can be halves).
 */
export function planChain(
  recipes: ChainRecipe[],
  finalRecipeId: string,
  batches: Decimal.Value,
  onHand: Map<string, Decimal.Value> = new Map(),
): ChainPlan {
  const final = recipes.find((r) => r.id === finalRecipeId);
  if (!final) throw new InventoryError("Pick a recipe from the list.");
  const loop = findLoop(recipes);
  if (loop) throw new InventoryError(`These recipes use each other's output in a circle: ${loop.join(" → ")}. Change one of them.`);
  const byItem = producers(recipes);
  const stock = (itemId: string) => new Decimal(onHand.get(itemId) ?? 0);

  // Depth-first from the final recipe: post-order lists makers before the recipes that use them.
  const order: ChainRecipe[] = [];
  const seen = new Set<string>();
  const walk = (r: ChainRecipe) => {
    seen.add(r.id);
    for (const line of r.lines) {
      const next = byItem.get(line.itemId);
      if (next && next.id !== r.id && !seen.has(next.id)) walk(next);
    }
    order.push(r);
  };
  walk(final);

  const demand = new Map<string, Decimal>(); // intermediates wanted, by item
  const rawNeed = new Map<string, Decimal>();
  const fromStock = new Map<string, Decimal>();
  const stages: ChainStage[] = [];
  // Consumers first, so every use of an intermediate is counted before its own recipe is sized.
  for (const r of [...order].reverse()) {
    let runBatches: Decimal;
    if (r.id === final.id) runBatches = new Decimal(batches);
    else {
      const wanted = demand.get(r.outputItemId) ?? new Decimal(0);
      const have = stock(r.outputItemId);
      const covered = Decimal.min(wanted, have);
      if (covered.gt(0)) fromStock.set(r.outputItemId, roundQty(covered));
      const toMake = wanted.sub(covered);
      if (toMake.lte(0)) continue; // stock covers it entirely
      runBatches = toMake.div(new Decimal(r.outputQuantity));
    }
    runBatches = runBatches.toDecimalPlaces(4, Decimal.ROUND_UP);
    const inputs = r.lines.map((line) => {
      const quantity = roundQty(new Decimal(line.quantity).mul(runBatches));
      const maker = byItem.get(line.itemId);
      const fromStage = Boolean(maker && maker.id !== r.id);
      if (fromStage) demand.set(line.itemId, (demand.get(line.itemId) ?? new Decimal(0)).add(quantity));
      else rawNeed.set(line.itemId, (rawNeed.get(line.itemId) ?? new Decimal(0)).add(quantity));
      return { itemId: line.itemId, quantity, fromStage };
    });
    stages.push({ recipeId: r.id, name: r.name, outputItemId: r.outputItemId, batches: runBatches, plannedOutput: roundQty(runBatches.mul(new Decimal(r.outputQuantity))), inputs });
  }

  // `stages` was built consumers first; runs go makers first.
  return {
    stages: stages.reverse(),
    raw: [...rawNeed].map(([itemId, needed]) => {
      const have = stock(itemId);
      return { itemId, needed: roundQty(needed), onHand: roundQty(have), short: roundQty(Decimal.max(0, needed.sub(have))) };
    }),
    usedFromStock: [...fromStock].map(([itemId, quantity]) => ({ itemId, quantity })),
  };
}
