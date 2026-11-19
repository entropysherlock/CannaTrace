import { and, eq, sql } from "drizzle-orm";
import { auditLogs, itemCategories, items, unitEnum } from "@/db/schema";
import { db } from "./db";
import { generateSku, normalizeSku } from "./ids";
import { InventoryError } from "./inventory-math";
import type { Actor } from "./inventory";

type Unit = (typeof unitEnum.enumValues)[number];

/** An active item with this name, ignoring letter case and extra spaces, so a quick add can offer it instead. */
export async function findItemByName(orgId: string, name: string): Promise<{ id: string; name: string; unit: Unit } | null> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const [row] = await db
    .select({ id: items.id, name: items.name, unit: items.unit })
    .from(items)
    .where(and(eq(items.orgId, orgId), eq(items.active, true), sql`lower(btrim(${items.name})) = lower(${clean})`));
  return row ?? null;
}

/**
 * Add a catalog item without leaving the page you are on. The category is found by name or made,
 * and a SKU is generated from the category when none is given.
 */
export async function quickAddItem(
  actor: Actor,
  input: { name: string; unit: string; category: string; sku?: string; strain?: string },
): Promise<{ id: string; name: string; unit: Unit }> {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) throw new InventoryError("Give the new item a name.");
  if (!(unitEnum.enumValues as readonly string[]).includes(input.unit)) throw new InventoryError("Choose a unit of measure for the new item.");
  const unit = input.unit as Unit;
  const categoryName = input.category.trim().slice(0, 60) || "General";
  return db.transaction(async (tx) => {
    const [dupe] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.orgId, actor.orgId), sql`lower(btrim(${items.name})) = lower(${name})`, eq(items.active, true)));
    if (dupe) throw new InventoryError(`You already have an item called ${name}. Pick it from the list.`);
    await tx.insert(itemCategories).values({ orgId: actor.orgId, name: categoryName }).onConflictDoNothing();
    const [category] = await tx
      .select({ id: itemCategories.id })
      .from(itemCategories)
      .where(and(eq(itemCategories.orgId, actor.orgId), eq(itemCategories.name, categoryName)));
    for (let attempt = 0; attempt < 5; attempt++) {
      // A typed SKU is used as is; otherwise a new unique one from the category (FLO-0007).
      const sku = input.sku?.trim() ? normalizeSku(input.sku) : await generateSku(tx, actor.orgId, categoryName);
      const [item] = await tx
        .insert(items)
        .values({ orgId: actor.orgId, name, sku, unit, categoryId: category.id, strain: input.strain?.trim().slice(0, 80) || null })
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
