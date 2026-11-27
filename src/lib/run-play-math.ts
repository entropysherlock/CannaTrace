import Decimal from "decimal.js";
import { roundQty } from "./units";

export type StockPackage = { id: string; tag: string; itemId: string; quantity: Decimal.Value; unit: string; createdAt: Date };
export type Pick = { packageId: string; tag: string; itemId: string; quantity: Decimal; unit: string };
export type Shortfall = { itemId: string; needed: Decimal; available: Decimal; short: Decimal };

/**
 * Choose which packages to use for what a recipe needs: oldest package first, and a package is emptied
 * before the next is started. Anything the stock cannot cover comes back as a shortfall, never as a guess.
 */
export function pickOldestFirst(needs: Map<string, Decimal>, stock: StockPackage[]): { picks: Pick[]; short: Shortfall[] } {
  const picks: Pick[] = [];
  const short: Shortfall[] = [];
  for (const [itemId, needed] of needs) {
    const pool = stock
      .filter((p) => p.itemId === itemId && new Decimal(p.quantity).gt(0))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.tag.localeCompare(b.tag));
    let left = new Decimal(needed);
    let available = new Decimal(0);
    for (const p of pool) {
      const have = new Decimal(p.quantity);
      available = available.add(have);
      if (left.lte(0)) continue;
      const take = Decimal.min(left, have);
      picks.push({ packageId: p.id, tag: p.tag, itemId, quantity: roundQty(take), unit: p.unit });
      left = left.sub(take);
    }
    if (left.gt(0)) short.push({ itemId, needed: roundQty(needed), available: roundQty(available), short: roundQty(left) });
  }
  return { picks, short };
}
