import { and, eq, sql } from "drizzle-orm";
import { auditLogs, itemCategories, items, unitEnum } from "@/db/schema";
import { db } from "./db";
import { generateSku, normalizeSku } from "./ids";
import { InventoryError } from "./inventory-math";
import type { Actor } from "./inventory";

type Unit = (typeof unitEnum.enumValues)[number];

/** An item name with case and every space ignored, so "3.5 g Jar" and "3.5g jar" count as the same item. */
export function nameKey(value: unknown) {
  return sql`lower(regexp_replace(${value}, '\\s+', '', 'g'))`;
}

/** A category with this name, ignoring letter case and extra spaces. */
export async function findCategoryByName(orgId: string, name: string): Promise<{ id: string; name: string } | null> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const [row] = await db
    .select({ id: itemCategories.id, name: itemCategories.name })
    .from(itemCategories)
    .where(and(eq(itemCategories.orgId, orgId), sql`lower(btrim(${itemCategories.name})) = lower(${clean})`));
  return row ?? null;
}

/** A new item category, as on the Items page. Names that differ only in case or spacing count as the same. */
export async function createCategory(actor: Actor, input: string): Promise<{ id: string; name: string }> {
  const name = input.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) throw new InventoryError("Enter a category name.");
  const twin = await findCategoryByName(actor.orgId, name);
  if (twin) throw new InventoryError(`There is already a category called ${twin.name}.`);
  const [row] = await db
    .insert(itemCategories)
    .values({ orgId: actor.orgId, name })
    .onConflictDoNothing({ target: [itemCategories.orgId, itemCategories.name] })
    .returning({ id: itemCategories.id });
  if (!row) throw new InventoryError(`There is already a category called ${name}.`);
  return { id: row.id, name };
}

/** An active item with this name, ignoring letter case and extra spaces, so a quick add can offer it instead. */
export async function findItemByName(orgId: string, name: string): Promise<{ id: string; name: string; unit: Unit } | null> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const [row] = await db
    .select({ id: items.id, name: items.name, unit: items.unit })
    .from(items)
    .where(and(eq(items.orgId, orgId), eq(items.active, true), sql`${nameKey(items.name)} = ${nameKey(clean)}`));
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
  const categoryName = input.category.trim().replace(/\s+/g, " ").slice(0, 60) || "General";
  return db.transaction(async (tx) => {
    const [dupe] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.orgId, actor.orgId), sql`${nameKey(items.name)} = ${nameKey(name)}`, eq(items.active, true)));
    if (dupe) throw new InventoryError(`You already have an item called ${name}. Pick it from the list.`);
    // "edibles" uses the existing "Edibles" category rather than making a near-twin.
    const findCategory = () =>
      tx
        .select({ id: itemCategories.id, name: itemCategories.name })
        .from(itemCategories)
        .where(and(eq(itemCategories.orgId, actor.orgId), sql`lower(btrim(${itemCategories.name})) = lower(${categoryName})`));
    let [category] = await findCategory();
    if (!category) {
      await tx.insert(itemCategories).values({ orgId: actor.orgId, name: categoryName }).onConflictDoNothing();
      [category] = await findCategory();
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      // A typed SKU is used as is; otherwise a new unique one from the category (FLO-0007).
      const sku = input.sku?.trim() ? normalizeSku(input.sku) : await generateSku(tx, actor.orgId, category.name);
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
          after: { name, sku, unit, category: category.name },
        });
        return { id: item.id, name, unit };
      }
      if (input.sku) throw new InventoryError(`SKU ${sku} is already used by another item.`);
    }
    throw new InventoryError("Could not make a unique SKU. Try a slightly different name.");
  });
}
