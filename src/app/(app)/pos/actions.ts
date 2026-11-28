"use server";

import { addSellableToMenu } from "@/lib/menu-bulk";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import type { Actor } from "@/lib/inventory";
import {
  closeDrawer,
  createDiscount,
  removeDiscount,
  removeMenuItem,
  saveRetailSettings,
  setMenuItem,
  voidSale,
  returnSale,
} from "@/lib/pos";
import { markReviewed } from "@/lib/offline-sales";
import { createPromotion, deletePromotion, setPromotionActive } from "@/lib/promotions";
import { adjustPoints, deleteMember, saveProgram, updateMember } from "@/lib/rewards";
import { giveBackPercent } from "@/lib/rewards-math";
import { saveMenuSettings, setReservationStatus, startSaleFromReservation } from "@/lib/online-menu";
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
    return { ok: `Return ${r.number} recorded. Refund $${r.amount} ${{ CASH: "in cash from your drawer", SPLIT: "back the way they paid: the cash part from your drawer and the rest to their card on the card terminal", CARD: "to their card on the card terminal" }[field(formData, "refundMethod")] ?? ""}.` };
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
      barcode: field(formData, "barcode"),
    });
    refresh();
    return { ok: "Menu item saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function addSellableToMenuAction(_state: FormState, _formData: FormData): Promise<FormState> {
  try {
    const { added, more } = await addSellableToMenu(await manager());
    refresh();
    if (added.length === 0) return { ok: "Everything with stock is already on the menu." };
    return { ok: `Added ${added.length} item${added.length === 1 ? "" : "s"} with stock to the menu${more ? `. ${more} more are waiting; press the button again` : ""}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function removeMenuItemAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = await removeMenuItem(await manager(), { itemId: field(formData, "itemId") });
    refresh();
    return { ok: `Removed ${name} from the menu.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function removeDiscountAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = await removeDiscount(await manager(), { discountId: field(formData, "discountId") });
    refresh();
    return { ok: `Removed ${name}.` };
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

export async function onlineMenuAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveMenuSettings(await manager(), {
      enabled: formData.get("enabled") === "on",
      slug: field(formData, "slug"),
      takeReservations: formData.get("takeReservations") === "on",
      welcome: field(formData, "welcome"),
      pickupNote: field(formData, "pickupNote"),
    });
    refresh();
    return { ok: formData.get("enabled") === "on" ? "Online menu saved. It is live." : "Online menu saved. It is off." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function pickupStatusAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setReservationStatus(await clerk(), { id: field(formData, "id"), status: field(formData, "status"), reason: field(formData, "reason") });
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function startPickupSaleAction(_state: FormState, formData: FormData): Promise<FormState> {
  let saleId: string;
  try {
    const r = await startSaleFromReservation(await clerk(), {
      id: field(formData, "id"),
      birthDate: field(formData, "birthDate"),
      idExpires: field(formData, "idExpires"),
      customerType: field(formData, "customerType"),
      idNumber: field(formData, "idNumber") || undefined,
    });
    saleId = r.saleId;
    refresh();
    if (r.left.length > 0) {
      // Show the budtender what could not be added, on the cart itself.
      redirect(`/pos/sales/${saleId}?notAdded=${encodeURIComponent(r.left.join(" | ").slice(0, 600))}`);
    }
  } catch (error) {
    unstable_rethrow(error);
    return toFormError(error);
  }
  redirect(`/pos/sales/${saleId}`);
}

export async function reviewSaleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await markReviewed(await manager(), { saleId: field(formData, "id"), note: field(formData, "note") });
    refresh();
    return { ok: "Marked as reviewed." };
  } catch (error) {
    return toFormError(error);
  }
}

// ---------- Rewards program (managers) ----------

export async function rewardsSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const program = await saveProgram(await manager(), Object.fromEntries(formData.entries()));
    refresh();
    return {
      ok: program.enabled
        ? `Rewards are on: ${program.pointsPerDollar} point${program.pointsPerDollar === 1 ? "" : "s"} per $1, ${program.redeemPoints} points = $${program.redeemDollars} off (${giveBackPercent(program)}% back).`
        : "Saved. Rewards are off, so the register won't show them.",
    };
  } catch (error) {
    return toFormError(error);
  }
}

export async function rewardsAdjustAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const member = await adjustPoints(await manager(), { memberId: field(formData, "memberId"), points: field(formData, "points"), reason: field(formData, "reason") });
    refresh();
    return { ok: `Saved. ${member.firstName} now has ${member.points} points.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function rewardsUpdateAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await updateMember(await manager(), {
      memberId: field(formData, "memberId"),
      phone: field(formData, "phone"),
      firstName: field(formData, "firstName"),
      birthday: field(formData, "birthday"),
    });
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function rewardsDeleteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    if (field(formData, "confirm").trim().toUpperCase() !== "DELETE") return { error: "Type DELETE to confirm. This can't be undone." };
    await deleteMember(await manager(), { memberId: field(formData, "memberId") });
    refresh();
  } catch (error) {
    return toFormError(error);
  }
  redirect("/pos/rewards?deleted=1");
}

// ---------- Promotions (managers) ----------

export async function promotionCreateAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const row = await createPromotion(await manager(), Object.fromEntries(formData.entries()), formData.getAll("weekdays").map(String));
    refresh();
    return { ok: `${row.name} is on. The register applies it by itself while it's running.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function promotionToggleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setPromotionActive(await manager(), field(formData, "id"), field(formData, "active") === "true");
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function promotionDeleteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await deletePromotion(await manager(), field(formData, "id"));
    refresh();
    return { ok: "Promotion deleted." };
  } catch (error) {
    return toFormError(error);
  }
}
