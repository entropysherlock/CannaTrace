import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { items } from "@/db/schema";
import { db, type Tx } from "./db";
import { InventoryError, audit, type Actor } from "./inventory";
import { nameKey } from "./quick-item";

/** Other active items whose names match this one once case and spaces are ignored. */
export async function findNameTwins(orgId: string, itemId: string): Promise<{ id: string; name: string; sku: string }[]> {
  const [item] = await db.select({ name: items.name }).from(items).where(and(eq(items.id, itemId), eq(items.orgId, orgId)));
  if (!item) return [];
  return db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .where(and(eq(items.orgId, orgId), eq(items.active, true), sql`${nameKey(items.name)} = ${nameKey(item.name)}`, sql`${items.id} <> ${itemId}`))
    .orderBy(asc(items.sku));
}

const rows = (result: unknown) => Number((result as { rowCount?: number | null }).rowCount ?? 0);

/** Move everything that points at the other items over to the one being kept, then retire the others. */
async function moveReferences(tx: Tx, keepId: string, fromId: string): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  const run = async (label: string, query: ReturnType<typeof sql>) => {
    moved[label] = (moved[label] ?? 0) + rows(await tx.execute(query));
  };

  // Records of what happened can't be combined, so a sale, order or reservation that holds both items stops the merge.
  for (const [table, parent, label] of [
    ["sale_lines", "sale_id", "sale"],
    ["order_lines", "order_id", "order"],
    ["reservation_lines", "reservation_id", "reservation"],
  ] as const) {
    const t = sql.identifier(table);
    const p = sql.identifier(parent);
    const both = await tx.execute(sql`SELECT 1 FROM ${t} a JOIN ${t} b ON a.${p} = b.${p} WHERE a.item_id = ${keepId} AND b.item_id = ${fromId} LIMIT 1`);
    if (rows(both) > 0) throw new InventoryError(`A ${label} has both items on it, and ${label} lines can't be combined. Nothing was changed.`);
  }

  await run("packages", sql`UPDATE packages SET item_id = ${keepId} WHERE item_id = ${fromId}`);
  await run("sale lines", sql`UPDATE sale_lines SET item_id = ${keepId} WHERE item_id = ${fromId}`);
  await run("order lines", sql`UPDATE order_lines SET item_id = ${keepId} WHERE item_id = ${fromId}`);
  await run("reservation lines", sql`UPDATE reservation_lines SET item_id = ${keepId} WHERE item_id = ${fromId}`);
  await run("production runs", sql`UPDATE production_runs SET output_item_id = ${keepId} WHERE output_item_id = ${fromId}`);
  await run("production inputs", sql`UPDATE production_inputs SET item_id = ${keepId} WHERE item_id = ${fromId}`);
  await run("recipes", sql`UPDATE boms SET output_item_id = ${keepId} WHERE output_item_id = ${fromId}`);
  await run("promotions", sql`UPDATE promotions SET item_id = ${keepId} WHERE item_id = ${fromId}`);
  // Settings keyed by item: where the kept item already has one, its own stays and the other is dropped.
  await run(
    "recipe lines",
    sql`UPDATE bom_lines SET item_id = ${keepId} WHERE item_id = ${fromId} AND bom_id NOT IN (SELECT bom_id FROM bom_lines WHERE item_id = ${keepId})`,
  );
  await tx.execute(sql`DELETE FROM bom_lines WHERE item_id = ${fromId}`);
  await run(
    "price list entries",
    sql`UPDATE price_list_items SET item_id = ${keepId} WHERE item_id = ${fromId} AND price_list_id NOT IN (SELECT price_list_id FROM price_list_items WHERE item_id = ${keepId})`,
  );
  await tx.execute(sql`DELETE FROM price_list_items WHERE item_id = ${fromId}`);
  await run(
    "shelf prices",
    sql`UPDATE retail_prices SET item_id = ${keepId} WHERE item_id = ${fromId} AND facility_id NOT IN (SELECT facility_id FROM retail_prices WHERE item_id = ${keepId})`,
  );
  await tx.execute(sql`DELETE FROM retail_prices WHERE item_id = ${fromId}`);
  return moved;
}

/**
 * Combine duplicate items into one. Packages, sales, orders, recipes and prices all move to the item being kept,
 * and the others are retired (not deleted, so the audit trail still points at them). All or nothing.
 */
export async function mergeItems(actor: Actor, input: { keepId: string; mergeIds: string[] }): Promise<{ merged: number; moved: Record<string, number> }> {
  const mergeIds = [...new Set(input.mergeIds.filter((id) => id && id !== input.keepId))];
  if (!mergeIds.length) throw new InventoryError("Choose at least one other item to merge in.");
  return db.transaction(async (tx) => {
    const everyId = [input.keepId, ...mergeIds].sort();
    const found = await tx.select().from(items).where(and(eq(items.orgId, actor.orgId), inArray(items.id, everyId))).orderBy(asc(items.id)).for("update");
    if (found.length !== everyId.length) throw new InventoryError("One of those items no longer exists. Nothing was changed.");
    const keep = found.find((i) => i.id === input.keepId)!;
    const moved: Record<string, number> = {};
    for (const other of found.filter((i) => i.id !== keep.id)) {
      if (other.unit !== keep.unit) {
        throw new InventoryError(`${other.name} (${other.sku}) is counted in ${other.unit.toLowerCase()} but ${keep.name} is counted in ${keep.unit.toLowerCase()}, so they can't be merged. Nothing was changed.`);
      }
      const result = await moveReferences(tx, keep.id, other.id);
      for (const [k, v] of Object.entries(result)) moved[k] = (moved[k] ?? 0) + v;
      await tx.update(items).set({ active: false }).where(eq(items.id, other.id));
      await audit(tx, actor, {
        entityType: "Item",
        entityId: other.id,
        action: "MERGE",
        before: { name: other.name, sku: other.sku, active: true },
        after: { active: false, mergedInto: keep.sku },
        reason: `Merged into ${keep.name} (${keep.sku})`,
      });
    }
    await audit(tx, actor, {
      entityType: "Item",
      entityId: keep.id,
      action: "MERGE",
      before: { mergedFrom: found.filter((i) => i.id !== keep.id).map((i) => i.sku) },
      after: moved,
      reason: `Merged ${mergeIds.length} duplicate item${mergeIds.length === 1 ? "" : "s"} into this one`,
    });
    return { merged: mergeIds.length, moved };
  });
}
