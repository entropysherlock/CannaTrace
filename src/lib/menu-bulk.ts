import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { items, retailPrices } from "@/db/schema";
import { db } from "@/lib/db";
import { audit, type Actor } from "@/lib/inventory";
import { sellableByItem, storePack } from "@/lib/pos";
import { NEEDS_PRICE } from "@/lib/menu-price";

const MAX_BATCH = 60;

/**
 * Put every active item that has stock the register can sell right now, and isn't on this store's menu yet, on the menu
 * marked "Needs a price". Nothing is guessed: the register won't sell an item until a manager types its shelf price.
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
  await db.transaction(async (tx) => {
    for (const b of batch) {
      await tx.insert(retailPrices).values({ facilityId: actor.facilityId, itemId: b.id, price: NEEDS_PRICE }).onConflictDoNothing();
      await audit(tx, actor, { entityType: "MenuItem", entityId: b.id, action: "SAVE", after: { item: b.name, price: null, source: "added with stock, needs a price" } });
    }
  });
  return { added: batch.map((b) => b.name), more: todo.length - batch.length };
}
