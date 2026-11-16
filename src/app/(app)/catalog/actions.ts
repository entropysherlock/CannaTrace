"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLogs, itemCategories, items, locations, unitEnum, locationTypeEnum } from "@/db/schema";
import { db } from "@/lib/db";
import { field, toFormError, type FormState } from "@/lib/form";
import { requirePermission } from "@/lib/session";

export async function addCategory(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const name = field(formData, "name");
    if (!name) return { error: "Enter a category name." };
    const [row] = await db
      .insert(itemCategories)
      .values({ orgId: session.orgId, name })
      .onConflictDoNothing({ target: [itemCategories.orgId, itemCategories.name] })
      .returning({ id: itemCategories.id });
    if (!row) return { error: `There is already a category called ${name}.` };
    revalidatePath("/catalog");
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function addItem(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("catalog.manage");
    const name = field(formData, "name");
    const sku = field(formData, "sku").toUpperCase();
    const unit = field(formData, "unit") as (typeof unitEnum.enumValues)[number];
    const categoryId = field(formData, "categoryId");
    if (!name || !sku) return { error: "Enter a name and a SKU." };
    if (!unitEnum.enumValues.includes(unit)) return { error: "Choose a unit of measure." };
    const [category] = await db
      .select({ id: itemCategories.id })
      .from(itemCategories)
      .where(and(eq(itemCategories.id, categoryId), eq(itemCategories.orgId, session.orgId)));
    if (!category) return { error: "Choose a category." };

    const created = await db.transaction(async (tx) => {
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
      return item;
    });
    if (!created) return { error: `SKU ${sku} is already used by another item.` };
    revalidatePath("/catalog");
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function setItemActive(formData: FormData): Promise<void> {
  const session = await requirePermission("catalog.manage");
  const id = field(formData, "itemId");
  const active = field(formData, "active") === "true";
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
    const name = field(formData, "name");
    const type = field(formData, "type") as (typeof locationTypeEnum.enumValues)[number];
    if (!name) return { error: "Enter a location name." };
    if (!locationTypeEnum.enumValues.includes(type)) return { error: "Choose a location type." };
    const created = await db.transaction(async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({ orgId: session.orgId, facilityId: session.facilityId, name, type })
        .onConflictDoNothing({ target: [locations.facilityId, locations.name] })
        .returning({ id: locations.id });
      if (!location) return null;
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        facilityId: session.facilityId,
        userId: session.userId,
        userName: session.name,
        entityType: "Location",
        entityId: location.id,
        action: "CREATE",
        after: { name, type },
      });
      return location;
    });
    if (!created) return { error: `This facility already has a location called ${name}.` };
    revalidatePath("/locations");
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}
