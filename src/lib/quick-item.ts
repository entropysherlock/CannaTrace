import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, itemCategories, items, unitEnum } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";
import type { Actor } from "./inventory";

type Unit = (typeof unitEnum.enumValues)[number];

/** A short SKU from the item's name, e.g. "Live Resin Cart 1g" -> "LRC1G-4827". */
export function skuFromName(name: string, suffix: number): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const stem = words.map((w) => (/^\d/.test(w) ? w : w[0])).join("").slice(0, 8) || "ITEM";
  return `${stem}-${String(suffix).padStart(4, "0")}`;
}

/**
 * Add a catalog item without leaving the page you are on. The category is found by name or made,
 * and a SKU is made up from the name when none is given.
 */
export async function quickAddItem(
  actor: Actor,
  input: { name: string; unit: string; category: string; sku?: string },
): Promise<{ id: string; name: string; unit: Unit }> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new InventoryError("Give the new item a name.");
  if (!(unitEnum.enumValues as readonly string[]).includes(input.unit)) throw new InventoryError("Choose a unit of measure for the new item.");
  const unit = input.unit as Unit;
  const categoryName = input.category.trim().slice(0, 60) || "General";
  return db.transaction(async (tx) => {
    const [dupe] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.orgId, actor.orgId), sql`lower(${items.name}) = lower(${name})`, eq(items.active, true)));
    if (dupe) throw new InventoryError(`You already have an item called ${name}. Pick it from the list.`);
    await tx.insert(itemCategories).values({ orgId: actor.orgId, name: categoryName }).onConflictDoNothing();
    const [category] = await tx
      .select({ id: itemCategories.id })
      .from(itemCategories)
      .where(and(eq(itemCategories.orgId, actor.orgId), eq(itemCategories.name, categoryName)));
    for (let attempt = 0; attempt < 5; attempt++) {
      const sku = input.sku?.trim().toUpperCase() || skuFromName(name, randomInt(1000, 10000));
      const [item] = await tx
        .insert(items)
        .values({ orgId: actor.orgId, name, sku, unit, categoryId: category.id })
        .onConflictDoNothing({ target: [items.orgId, items.sku] })
        .returning({ id: items.id });
      if (item) {
        await tx.insert(auditLogs).values({
          orgId: actor.orgId,
          userId: actor.userId,
          userName: actor.userName,
          entityType: "Item",
          entityId: item.id,
          action: "CREATE",
          after: { name, sku, unit, category: categoryName },
        });
        return { id: item.id, name, unit };
      }
      if (input.sku) throw new InventoryError(`SKU ${sku} is already used by another item.`);
    }
    throw new InventoryError("Could not make a unique SKU. Try a slightly different name.");
  });
}
