"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import type { Actor } from "@/lib/inventory";
import {
  closeDrawer,
  createDiscount,
  saveRetailSettings,
  setMenuItem,
  voidSale,
  returnSale,
} from "@/lib/pos";
import type { Permission } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";

async function actorWith(permission: Permission): Promise<Actor> {
  const session = await requirePermission(permission);
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}
const clerk = () => actorWith("pos.use");
const manager = () => actorWith("pos.manage");
const refresh = () => revalidatePath("/pos", "layout");

export async function closeDrawerAction(_state: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    // Closing someone else's drawer (they left without counting) is a manager's job.
    const drawerId = field(formData, "drawerId") || undefined;
    id = (await closeDrawer(await (drawerId ? manager() : clerk()), { countedCash: field(formData, "countedCash"), drawerId })).id;
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect(`/pos/drawer/${id}`);
}

export async function voidSaleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await voidSale(await manager(), { saleId: field(formData, "saleId"), reason: field(formData, "reason") });
    refresh();
    revalidatePath("/inventory");
    return { ok: "Sale voided. The product is back in stock." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function returnSaleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const lines = [...formData.keys()].filter((k) => k.startsWith("qty:")).map((k) => ({ saleLineId: k.slice(4), quantity: field(formData, k) }));
    const r = await returnSale(await manager(), {
      saleId: field(formData, "saleId"),
      lines,
      refundMethod: field(formData, "refundMethod"),
      disposition: field(formData, "disposition"),
      reason: field(formData, "reason"),
    });
    refresh();
    revalidatePath("/inventory");
    return { ok: `Return ${r.number} recorded. Refund $${r.amount} ${field(formData, "refundMethod") === "CASH" ? "in cash from your drawer" : "to their card on the card terminal"}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function retailSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveRetailSettings(await manager(), {
      flowerLimitGrams: field(formData, "flowerLimitGrams"),
      concentrateLimitGrams: field(formData, "concentrateLimitGrams"),
      edibleLimitMg: field(formData, "edibleLimitMg"),
      exciseTaxPercent: field(formData, "exciseTaxPercent"),
      salesTaxPercent: field(formData, "salesTaxPercent"),
      medicalTaxExempt: formData.get("medicalTaxExempt") === "on",
      dailyLimits: formData.get("dailyLimits") === "on",
      receiptWarning: String(formData.get("receiptWarning") ?? ""),
      labelWarning: String(formData.get("labelWarning") ?? ""),
    });
    refresh();
    return { ok: "Store rules saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function menuItemAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setMenuItem(await manager(), {
      itemId: field(formData, "itemId"),
      price: field(formData, "price"),
      limitCategory: field(formData, "limitCategory"),
      limitPerUnit: field(formData, "limitPerUnit"),
    });
    refresh();
    return { ok: "Menu item saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function discountPresetAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = field(formData, "name");
    await createDiscount(await manager(), { name, percent: field(formData, "percent") });
    refresh();
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}
