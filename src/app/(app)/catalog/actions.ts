"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLogs, itemCategories, items, unitEnum } from "@/db/schema";
import { db } from "@/lib/db";
import { createLocation } from "@/lib/facilities";
import { field, toFormError, type FormState } from "@/lib/form";
import { generateSku, normalizeSku } from "@/lib/ids";
import { renameItem, saveItemDetails } from "@/lib/item-details";
import { findNameTwins, mergeItems } from "@/lib/merge-items";
import { createCategory, findItemByName } from "@/lib/quick-item";
import { requirePermission } from "@/lib/session";

export async function addCategory(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const category = await createCategory({ orgId: session.orgId, userId: session.userId, userName: session.name, facilityId: session.facilityId }, field(formData, "name"));
    revalidatePath("/catalog");
    return { ok: `Added ${category.name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function addItem(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const name = field(formData, "name");
    const typedSku = field(formData, "sku");
    const unit = field(formData, "unit") as (typeof unitEnum.enumValues)[number];
    const categoryId = field(formData, "categoryId");
    if (!name) return { error: "Enter a name." };
    const twin = await findItemByName(session.orgId, name);
    if (twin) return { error: `You already have an item called ${twin.name}.` };
    const givenSku = typedSku ? normalizeSku(typedSku) : null;
    if (!unitEnum.enumValues.includes(unit)) return { error: "Choose a unit of measure." };
    const [category] = await db
      .select({ id: itemCategories.id, name: itemCategories.name })
      .from(itemCategories)
      .where(and(eq(itemCategories.id, categoryId), eq(itemCategories.orgId, session.orgId)));
    if (!category) return { error: "Choose a category." };

    const created = await db.transaction(async (tx) => {
      // Left blank, the SKU is generated from the category (FLO-0007). It can be changed later on the item's page.
      const sku = givenSku ?? (await generateSku(tx, session.orgId, category.name));
      const [item] = await tx
        .insert(items)
        .values({ orgId: session.orgId, name, sku, unit, categoryId, strain: field(formData, "strain") || null })
        .onConflictDoNothing({ target: [items.orgId, items.sku] })
        .returning({ id: items.id });
      if (!item) return null;
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        userName: session.name,
        entityType: "Item",
        entityId: item.id,
        action: "CREATE",
        after: { name, sku, unit },
      });
      return { ...item, sku };
    });
    if (!created) return { error: `SKU ${givenSku} is already used by another item.` };
    revalidatePath("/catalog");
    return { ok: `Added ${name} (SKU ${created.sku}).` };
  } catch (error) {
    return toFormError(error);
  }
}

/** Fold items that share a name into the one being kept. */
export async function mergeItemsAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const keepId = field(formData, "keepId");
    const actor = { orgId: session.orgId, userId: session.userId, userName: session.name, facilityId: session.facilityId };
    const twins = await findNameTwins(session.orgId, keepId);
    const r = await mergeItems(actor, { keepId, mergeIds: twins.map((t) => t.id) });
    revalidatePath("/catalog", "layout");
    revalidatePath("/inventory", "layout");
    return { ok: `Merged ${r.merged} duplicate item${r.merged === 1 ? "" : "s"} into this one. ${r.moved.packages ?? 0} package${(r.moved.packages ?? 0) === 1 ? "" : "s"} moved.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function setItemActive(formData: FormData): Promise<void> {
  const session = await requirePermission("catalog.manage");
  const id = field(formData, "itemId");
  const active = field(formData, "active") === "true";
  if (active) {
    const twins = await findNameTwins(session.orgId, id);
    // Bringing back an item that shares a name with a live one would make a duplicate, so leave it retired.
    if (twins.length) return;
  }
  await db.transaction(async (tx) => {
    const [item] = await tx
      .update(items)
      .set({ active })
      .where(and(eq(items.id, id), eq(items.orgId, session.orgId)))
      .returning({ id: items.id });
    if (!item) return;
    await tx.insert(auditLogs).values({
      orgId: session.orgId,
      userId: session.userId,
      userName: session.name,
      entityType: "Item",
      entityId: item.id,
      action: active ? "REACTIVATE" : "RETIRE",
    });
  });
  revalidatePath("/catalog");
}

export async function addLocation(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const location = await createLocation(
      { orgId: session.orgId, userId: session.userId, userName: session.name, facilityId: session.facilityId },
      { name: field(formData, "name"), type: field(formData, "type") },
    );
    revalidatePath("/locations");
    return { ok: `Added ${location.name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function saveItemDetailsAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const itemId = field(formData, "itemId");
    const result = await saveItemDetails({ orgId: session.orgId, userId: session.userId, userName: session.name }, itemId, {
      unitWeightGrams: field(formData, "unitWeightGrams"),
      servingsPerUnit: field(formData, "servingsPerUnit"),
      thcMgPerServing: field(formData, "thcMgPerServing"),
      cbdMgPerServing: field(formData, "cbdMgPerServing"),
      directions: field(formData, "directions"),
      ingredients: field(formData, "ingredients"),
      allergens: field(formData, "allergens"),
      pesticides: field(formData, "pesticides"),
      solvents: field(formData, "solvents"),
      mustRefrigerate: field(formData, "mustRefrigerate") === "yes",
      returnable: field(formData, "returnable") === "yes",
      shelfLifeDays: field(formData, "shelfLifeDays"),
    });
    revalidatePath("/catalog");
    revalidatePath(`/catalog/${itemId}`);
    return { ok: result.changed ? `Saved label details for ${result.name}.` : "Nothing changed." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function renameItemAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const itemId = field(formData, "itemId");
    const result = await renameItem({ orgId: session.orgId, userId: session.userId, userName: session.name }, itemId, {
      name: field(formData, "name"),
      sku: field(formData, "sku"),
    });
    revalidatePath("/catalog");
    revalidatePath(`/catalog/${itemId}`);
    return { ok: result.changed ? `Saved. ${result.name} · SKU ${result.sku}.` : "Nothing changed." };
  } catch (error) {
    return toFormError(error);
  }
}
