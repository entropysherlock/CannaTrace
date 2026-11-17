import "server-only";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { itemCategories, items, retailPrices } from "@/db/schema";
import { db, type Tx } from "./db";
import { parsePrice } from "./distribution-math";
import { InventoryError, audit, type Actor } from "./inventory";
import { parsePositiveQty } from "./inventory-math";

/** What can be changed on many catalog items at once. */
export type ItemChanges = Partial<{
  category: string;
  strain: string | null;
  active: boolean;
  limitCategory: "NONE" | "FLOWER" | "CONCENTRATE" | "EDIBLE";
  limitPerUnit: string | null;
  /** Shelf price at the current facility's register. */
  retailPrice: string;
}>;

/** Check item changes. Category names are matched (or created) when applied. */
export function cleanItemChanges(raw: Record<string, unknown>): ItemChanges {
  const out: ItemChanges = {};
  if ("category" in raw) {
    const c = String(raw.category ?? "").trim().slice(0, 60);
    if (!c) throw new InventoryError("Give the category a name.");
    out.category = c;
  }
  if ("strain" in raw) out.strain = raw.strain === null || String(raw.strain).trim() === "" ? null : String(raw.strain).trim().slice(0, 80);
  if ("active" in raw) out.active = Boolean(raw.active);
  if ("limitCategory" in raw) {
    const v = String(raw.limitCategory ?? "").toUpperCase();
    if (!["NONE", "FLOWER", "CONCENTRATE", "EDIBLE"].includes(v)) throw new InventoryError("Purchase-limit type must be none, flower, concentrate, or edible.");
    out.limitCategory = v as ItemChanges["limitCategory"];
  }
  if ("limitPerUnit" in raw) out.limitPerUnit = raw.limitPerUnit === null || String(raw.limitPerUnit).trim() === "" ? null : parsePositiveQty(raw.limitPerUnit, "Amount each unit counts").toString();
  if (out.limitCategory && out.limitCategory !== "NONE" && "limitPerUnit" in out && out.limitPerUnit === null)
    throw new InventoryError("Say how much each unit counts toward the limit, for example 3.5 grams or 100 mg.");
  if ("retailPrice" in raw) {
    const p = parsePrice(raw.retailPrice, "Shelf price");
    if (p.lte(0)) throw new InventoryError("Shelf price must be more than zero.");
    out.retailPrice = p.toFixed(2);
  }
  return out;
}

async function categoryId(tx: Tx, orgId: string, name: string): Promise<string> {
  await tx.insert(itemCategories).values({ orgId, name }).onConflictDoNothing();
  const [row] = await tx.select({ id: itemCategories.id }).from(itemCategories).where(and(eq(itemCategories.orgId, orgId), eq(itemCategories.name, name)));
  return row.id;
}

/**
 * Apply the same changes to many items in one go: all or nothing, with an audit entry for each item.
 * Shelf prices apply at the person's current facility.
 */
export async function updateItems(actor: Actor, itemIds: string[], raw: Record<string, unknown>): Promise<number> {
  if (itemIds.length === 0) throw new InventoryError("No items were chosen.");
  const changes = cleanItemChanges(raw);
  if (Object.keys(changes).length === 0) throw new InventoryError("Nothing to change.");
  return db.transaction(async (tx) => {
    const catId = changes.category ? await categoryId(tx, actor.orgId, changes.category) : null;
    let n = 0;
    for (const id of itemIds) {
      const [before] = await tx.select().from(items).where(and(eq(items.id, id), eq(items.orgId, actor.orgId))).for("update");
      if (!before) throw new InventoryError("One of the items no longer exists. Nothing was changed.");
      const set: Partial<typeof items.$inferInsert> = {};
      if (catId) set.categoryId = catId;
      if ("strain" in changes) set.strain = changes.strain;
      if ("active" in changes) set.active = changes.active;
      if (changes.limitCategory) {
        set.limitCategory = changes.limitCategory;
        set.limitPerUnit = changes.limitCategory === "NONE" ? null : (changes.limitPerUnit ?? before.limitPerUnit);
        if (changes.limitCategory !== "NONE" && !set.limitPerUnit)
          throw new InventoryError(`${before.name} needs an amount each unit counts toward the limit. Nothing was changed.`);
      } else if ("limitPerUnit" in changes) {
        if (before.limitCategory === "NONE") throw new InventoryError(`${before.name} doesn't count toward a purchase limit, so it has no amount to change. Nothing was changed.`);
        set.limitPerUnit = changes.limitPerUnit;
      }
      if (Object.keys(set).length) await tx.update(items).set(set).where(eq(items.id, id));
      let priceBefore: string | null = null;
      if (changes.retailPrice) {
        const [p] = await tx.select({ price: retailPrices.price }).from(retailPrices).where(and(eq(retailPrices.facilityId, actor.facilityId), eq(retailPrices.itemId, id)));
        priceBefore = p ? new Decimal(p.price).toFixed(2) : null;
        await tx
          .insert(retailPrices)
          .values({ facilityId: actor.facilityId, itemId: id, price: changes.retailPrice })
          .onConflictDoUpdate({ target: [retailPrices.facilityId, retailPrices.itemId], set: { price: changes.retailPrice } });
      }
      await audit(tx, actor, {
        entityType: "Item",
        entityId: id,
        action: "UPDATE",
        before: {
          categoryId: before.categoryId,
          strain: before.strain,
          active: before.active,
          limitCategory: before.limitCategory,
          limitPerUnit: before.limitPerUnit,
          ...(changes.retailPrice ? { retailPrice: priceBefore } : {}),
        },
        after: changes,
      });
      n++;
    }
    return n;
  });
}
