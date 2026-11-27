"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import type { Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import {
  addPurchaseOrderLine,
  changePurchaseOrder,
  createPurchaseOrder,
  importPurchaseOrder,
  receivePurchaseOrder,
  receiveWholePurchaseOrder,
  removePurchaseOrderLine,
} from "@/lib/purchasing";
import { requirePermission } from "@/lib/session";

async function buyer(): Promise<Actor> {
  const s = await requirePermission("inventory.write");
  return { userId: s.userId, userName: s.name, orgId: s.orgId, facilityId: s.facilityId };
}
const refresh = () => {
  revalidatePath("/purchasing", "layout");
  revalidatePath("/inventory");
};

export async function createPoAction(_: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const po = await createPurchaseOrder(await buyer(), { vendorId: field(formData, "vendorId"), expectedOn: field(formData, "expectedOn"), notes: field(formData, "notes") });
    id = po.id;
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect(`/purchasing/${id}`);
}

export async function importPoAction(_: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new InventoryError("Choose a CSV file to import.");
    if (file.size > 2_000_000) throw new InventoryError("The file is larger than 2 MB.");
    const { po } = await importPurchaseOrder(await buyer(), {
      vendorId: field(formData, "vendorId"),
      csv: await file.text(),
      expectedOn: field(formData, "expectedOn"),
      notes: field(formData, "notes"),
    });
    id = po.id;
  } catch (error) {
    return toFormError(error);
  }
  refresh();
  redirect(`/purchasing/${id}`);
}

export async function addPoLineAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await addPurchaseOrderLine(await buyer(), {
      purchaseOrderId: field(formData, "purchaseOrderId"),
      itemId: field(formData, "itemId"),
      quantity: field(formData, "quantity"),
      unitCost: field(formData, "unitCost"),
    });
    refresh();
    return { ok: "Line added." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function removePoLineAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await removePurchaseOrderLine(await buyer(), { lineId: field(formData, "lineId") });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function poStepAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const step = field(formData, "step");
    const po = await changePurchaseOrder(await buyer(), { purchaseOrderId: field(formData, "purchaseOrderId"), step });
    refresh();
    return { ok: step === "send" ? `${po.number} is marked sent to the vendor.` : step === "cancel" ? `${po.number} is cancelled.` : `${po.number} is closed. Nothing more is expected on it.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function receivePoAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const lineIds = formData.getAll("lineId").map(String);
    const { po, packages } = await receivePurchaseOrder(await buyer(), {
      purchaseOrderId: field(formData, "purchaseOrderId"),
      locationId: field(formData, "locationId"),
      note: field(formData, "note"),
      lines: lineIds.map((lineId) => ({
        lineId,
        quantity: field(formData, `qty:${lineId}`),
        tag: field(formData, `tag:${lineId}`),
        lotNumber: field(formData, `lot:${lineId}`),
      })),
    });
    refresh();
    return { ok: `Received ${packages.length} package${packages.length === 1 ? "" : "s"} (${packages.map((p) => p.tag).join(", ")}). ${po.number} is now ${po.status.toLowerCase()}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function receiveWholePoAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const { po, packages } = await receiveWholePurchaseOrder(await buyer(), {
      purchaseOrderId: field(formData, "purchaseOrderId"),
      locationId: field(formData, "locationId"),
    });
    refresh();
    return { ok: `Received everything: ${packages.length} package${packages.length === 1 ? "" : "s"} (${packages.map((p) => p.tag).join(", ")}). ${po.number} is now ${po.status.toLowerCase()}.` };
  } catch (error) {
    return toFormError(error);
  }
}
