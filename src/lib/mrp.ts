import Decimal from "decimal.js";
import { findLoop, type ChainPlan, type ChainRecipe, type ChainStage } from "./bom-tree";
import { InventoryError } from "./inventory-math";
import { roundQty } from "./units";

export type Demand = { recipeId: string; batches: Decimal.Value };

/**
 * Material requirements for several things you want to make at once. Each wanted recipe is sized,
 * every intermediate it needs is made only as far as stock does not cover it, and the raw materials
 * of all of it are added up against what is on hand. Same chain rules as planChain, many targets.
 */
export function planDemand(recipes: ChainRecipe[], wanted: Demand[], onHand: Map<string, Decimal.Value> = new Map()): ChainPlan {
  if (wanted.length === 0) throw new InventoryError("Add at least one recipe to plan.");
  const loop = findLoop(recipes);
  if (loop) throw new InventoryError(`These recipes use each other's output in a circle: ${loop.join(" → ")}. Change one of them.`);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const byItem = new Map<string, ChainRecipe>();
  for (const r of [...recipes].sort((a, b) => a.name.localeCompare(b.name))) if (!byItem.has(r.outputItemId)) byItem.set(r.outputItemId, r);
  const stock = (itemId: string) => new Decimal(onHand.get(itemId) ?? 0);

  const direct = new Map<string, Decimal>(); // batches asked for, by recipe
  for (const w of wanted) {
    if (!byId.has(w.recipeId)) throw new InventoryError("Pick a recipe from the list.");
    const n = new Decimal(w.batches);
    if (!n.isFinite() || n.lte(0)) throw new InventoryError("Batches must be more than zero.");
    direct.set(w.recipeId, (direct.get(w.recipeId) ?? new Decimal(0)).add(n));
  }

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
  for (const id of direct.keys()) if (!seen.has(id)) walk(byId.get(id)!);

  const demand = new Map<string, Decimal>();
  const rawNeed = new Map<string, Decimal>();
  const fromStock = new Map<string, Decimal>();
  const stages: ChainStage[] = [];
  for (const r of [...order].reverse()) {
    const asked = direct.get(r.id) ?? new Decimal(0);
    const need = demand.get(r.outputItemId) ?? new Decimal(0);
    const covered = Decimal.min(need, stock(r.outputItemId));
    if (covered.gt(0)) fromStock.set(r.outputItemId, roundQty(covered));
    let runBatches = asked.add(need.sub(covered).div(new Decimal(r.outputQuantity)));
    if (runBatches.lte(0)) continue;
    runBatches = runBatches.toDecimalPlaces(4, Decimal.ROUND_UP);
    const inputs = r.lines.map((line) => {
      const quantity = roundQty(new Decimal(line.quantity).mul(runBatches));
      const maker = byItem.get(line.itemId);
      const fromStage = Boolean(maker && maker.id !== r.id);
      const bucket = fromStage ? demand : rawNeed;
      bucket.set(line.itemId, (bucket.get(line.itemId) ?? new Decimal(0)).add(quantity));
      return { itemId: line.itemId, quantity, fromStage };
    });
    stages.push({ recipeId: r.id, name: r.name, outputItemId: r.outputItemId, batches: runBatches, plannedOutput: roundQty(runBatches.mul(new Decimal(r.outputQuantity))), inputs });
  }
  return {
    stages: stages.reverse(),
    raw: [...rawNeed].map(([itemId, needed]) => {
      const have = stock(itemId);
      return { itemId, needed: roundQty(needed), onHand: roundQty(have), short: roundQty(Decimal.max(0, needed.sub(have))) };
    }),
    usedFromStock: [...fromStock].map(([itemId, quantity]) => ({ itemId, quantity })),
  };
}
