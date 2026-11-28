import Decimal from "decimal.js";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { items, packages, retailPrices } from "@/db/schema";
import { db } from "@/lib/db";
import { audit, type Actor } from "@/lib/inventory";
import { sellableByItem, storePack } from "@/lib/pos";

const store = (value: Decimal) => value.toFixed(4);
const MAX_BATCH = 60;
const MARKUP = new Decimal("2.5");
const FALLBACK_PRICE = new Decimal(10);

/** A starting shelf price from what the stock cost: 2.5 times the dearest package cost, to the cent, and never under $1. */
export function startingPrice(costs: Array<string | null>): Decimal {
  const known = costs.filter((c): c is string => c !== null && c !== "").map((c) => new Decimal(c)).filter((c) => c.gt(0));
  if (known.length === 0) return FALLBACK_PRICE;
  const price = Decimal.max(...known).mul(MARKUP).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return price.lt(1) ? new Decimal(1) : price;
}

/**
 * Put every active item that has stock the register can sell right now, and no price at this store yet, on the menu.
 * Prices start from cost (see startingPrice) and can be changed afterwards under Add or change a menu item.
 */
export async function addSellableToMenu(actor: Actor): Promise<{ added: string[]; more: number }> {
  const pack = await storePack(db, actor.facilityId);
  const sellable = await sellableByItem(db, actor, pack);
  const withStock = [...sellable].filter(([, qty]) => qty.gt(0)).map(([id]) => id);
  if (withStock.length === 0) return { added: [], more: 0 };
  const onMenu = await db.select({ id: retailPrices.itemId }).from(retailPrices).where(eq(retailPrices.facilityId, actor.facilityId));
  const have = onMenu.map((r) => r.id);
  const todo = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.orgId, actor.orgId), eq(items.active, true), inArray(items.id, withStock), have.length ? notInArray(items.id, have) : sql`true`))
    .orderBy(items.name);
  const batch = todo.slice(0, MAX_BATCH);
  if (batch.length === 0) return { added: [], more: 0 };
  const costRows = await db
    .select({ itemId: packages.itemId, cost: packages.costPerUnit })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), inArray(packages.itemId, batch.map((b) => b.id))));
  const costsByItem = new Map<string, Array<string | null>>();
  for (const r of costRows) costsByItem.set(r.itemId, [...(costsByItem.get(r.itemId) ?? []), r.cost === null ? null : String(r.cost)]);
  await db.transaction(async (tx) => {
    for (const b of batch) {
      const price = startingPrice(costsByItem.get(b.id) ?? []);
      await tx
        .insert(retailPrices)
        .values({ facilityId: actor.facilityId, itemId: b.id, price: store(price) })
        .onConflictDoNothing();
      await audit(tx, actor, { entityType: "MenuItem", entityId: b.id, action: "SAVE", after: { item: b.name, price: price.toString(), source: "added with stock" } });
    }
  });
  return { added: batch.map((b) => b.name), more: todo.length - batch.length };
}
