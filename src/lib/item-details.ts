import "server-only";
import Decimal from "decimal.js";
import { and, eq, ne, sql } from "drizzle-orm";
import { auditLogs, items } from "@/db/schema";
import { db } from "./db";
import { normalizeSku } from "./ids";
import { InventoryError } from "./inventory-math";
import { nameKey } from "./quick-item";

/** What a product label needs to know about an item, beyond its name and SKU. All optional. */
export type ItemDetailsInput = {
  unitWeightGrams?: string;
  servingsPerUnit?: string;
  thcMgPerServing?: string;
  cbdMgPerServing?: string;
  directions?: string;
  ingredients?: string;
  allergens?: string;
  pesticides?: string;
  solvents?: string;
  mustRefrigerate?: boolean;
  returnable?: boolean;
  shelfLifeDays?: string;
};

type Actor = { orgId: string; userId: string; userName: string };

function number(raw: string | undefined, what: string, opts: { max: number; integer?: boolean; dp?: number }): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  let v: Decimal;
  try {
    v = new Decimal(text);
  } catch {
    throw new InventoryError(`${what} must be a number.`);
  }
  if (!v.isFinite() || v.lte(0) || v.gt(opts.max)) throw new InventoryError(`${what} must be more than 0 and at most ${opts.max.toLocaleString("en-US")}.`);
  if (opts.integer && !v.isInteger()) throw new InventoryError(`${what} must be a whole number.`);
  return opts.integer ? v.toFixed(0) : v.toFixed(opts.dp ?? 4);
}

const words = (raw: string | undefined, max: number) =>
  (raw ?? "")
    .trim()
    .replace(/[ \t]+/g, " ")
    .slice(0, max) || null;

export function cleanItemDetails(input: ItemDetailsInput) {
  const servings = number(input.servingsPerUnit, "Servings per unit", { max: 1000, integer: true });
  const thc = number(input.thcMgPerServing, "THC per serving", { max: 10000, dp: 3 });
  const cbd = number(input.cbdMgPerServing, "CBD per serving", { max: 10000, dp: 3 });
  if ((thc || cbd) && !servings) throw new InventoryError("Enter servings per unit when you enter mg per serving.");
  const shelf = number(input.shelfLifeDays, "Shelf life", { max: 3650, integer: true });
  return {
    unitWeightGrams: number(input.unitWeightGrams, "Unit weight", { max: 100000 }),
    servingsPerUnit: servings === null ? null : Number(servings),
    thcMgPerServing: thc,
    cbdMgPerServing: cbd,
    directions: words(input.directions, 500),
    ingredients: words(input.ingredients, 1500),
    allergens: words(input.allergens, 300),
    pesticides: words(input.pesticides, 500),
    solvents: words(input.solvents, 500),
    mustRefrigerate: Boolean(input.mustRefrigerate),
    returnable: Boolean(input.returnable),
    shelfLifeDays: shelf === null ? null : Number(shelf),
  };
}

/** Save an item's label details. Every change is in the audit trail. */
export async function saveItemDetails(actor: Actor, itemId: string, input: ItemDetailsInput) {
  const values = cleanItemDetails(input);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.orgId, actor.orgId)));
    if (!before) throw new InventoryError("That item was not found.");
    await tx.update(items).set(values).where(eq(items.id, itemId));
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => String(before[k as keyof typeof before] ?? "") !== String(v ?? "")));
    if (Object.keys(changed).length) {
      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        userId: actor.userId,
        userName: actor.userName,
        entityType: "Item",
        entityId: itemId,
        action: "UPDATE",
        reason: "Label details",
        before: Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before] ?? null])),
        after: changed,
      });
    }
    return { name: before.name, changed: Object.keys(changed).length };
  });
}

/**
 * Change an item's name or SKU. A SKU must stay unique in the business. Packages keep pointing at the
 * same item, so nothing else changes; labels printed from now on show the new values.
 */
export async function renameItem(actor: Actor, itemId: string, input: { name: string; sku: string }) {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) throw new InventoryError("Enter the item's name.");
  const sku = normalizeSku(input.sku);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.orgId, actor.orgId)));
    if (!before) throw new InventoryError("That item was not found.");
    if (before.name === name && before.sku === sku) return { name, sku, changed: false };
    if (sku !== before.sku) {
      const [taken] = await tx.select({ id: items.id }).from(items).where(and(eq(items.orgId, actor.orgId), eq(items.sku, sku)));
      if (taken) throw new InventoryError(`SKU ${sku} is already used by another item.`);
    }
    // No two active items may share a name (capitals and spaces ignored), the same rule as adding one.
    if (before.active) {
      const [twin] = await tx
        .select({ name: items.name })
        .from(items)
        .where(and(eq(items.orgId, actor.orgId), eq(items.active, true), ne(items.id, itemId), sql`${nameKey(items.name)} = ${nameKey(name)}`));
      if (twin) throw new InventoryError(`You already have an item called ${twin.name}.`);
    }
    await tx.update(items).set({ name, sku }).where(eq(items.id, itemId));
    await tx.insert(auditLogs).values({
      orgId: actor.orgId,
      userId: actor.userId,
      userName: actor.userName,
      entityType: "Item",
      entityId: itemId,
      action: "UPDATE",
      reason: "Name or SKU changed",
      before: { name: before.name, sku: before.sku },
      after: { name, sku },
    });
    return { name, sku, changed: true };
  });
}
