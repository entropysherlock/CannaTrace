"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import type { Actor } from "@/lib/inventory";
import {
  addToCart,
  cancelCart,
  checkInCustomer,
  closeDrawer,
  completeSale,
  createDiscount,
  openDrawer,
  removeFromCart,
  saveRetailSettings,
  setCartDiscount,
  setMenuItem,
  voidSale,
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

export async function openDrawerAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await openDrawer(await clerk(), { openingCash: field(formData, "openingCash") });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function closeDrawerAction(_state: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    id = (await closeDrawer(await clerk(), { countedCash: field(formData, "countedCash") })).id;
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect(`/pos/drawer/${id}`);
}

export async function checkInAction(_state: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const sale = await checkInCustomer(await clerk(), {
      birthDate: field(formData, "birthDate"),
      idExpires: field(formData, "idExpires"),
      customerType: field(formData, "customerType"),
    });
    id = sale.id;
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect(`/pos/sales/${id}`);
}

export async function addToCartAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await addToCart(await clerk(), { saleId: field(formData, "saleId"), itemId: field(formData, "itemId"), quantity: field(formData, "quantity") || "1" });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function removeFromCartAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await removeFromCart(await clerk(), { lineId: field(formData, "lineId") });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function cartDiscountAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setCartDiscount(await clerk(), { saleId: field(formData, "saleId"), discountId: field(formData, "discountId") });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function payAction(_state: FormState, formData: FormData): Promise<FormState> {
  const saleId = field(formData, "saleId");
  try {
    await completeSale(await clerk(), { saleId, paymentMethod: field(formData, "paymentMethod"), cashTendered: field(formData, "cashTendered") });
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  revalidatePath("/inventory");
  redirect(`/pos/sales/${saleId}/receipt`);
}

export async function cancelCartAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await cancelCart(await clerk(), { saleId: field(formData, "saleId") });
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect("/pos");
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

export async function retailSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveRetailSettings(await manager(), {
      flowerLimitGrams: field(formData, "flowerLimitGrams"),
      concentrateLimitGrams: field(formData, "concentrateLimitGrams"),
      edibleLimitMg: field(formData, "edibleLimitMg"),
      exciseTaxPercent: field(formData, "exciseTaxPercent"),
      salesTaxPercent: field(formData, "salesTaxPercent"),
      medicalTaxExempt: formData.get("medicalTaxExempt") === "on",
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
