"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { adjustPackage, movePackage, receivePackage, type Actor } from "@/lib/inventory";
import { requirePermission, type Session } from "@/lib/session";

function actorOf(session: Session): Actor {
  return {
    userId: session.userId,
    userName: session.name,
    orgId: session.orgId,
    facilityId: session.facilityId,
  };
}

export async function receiveAction(_state: FormState, formData: FormData): Promise<FormState> {
  let packageId: string;
  try {
    const session = await requirePermission("inventory.write");
    const pkg = await receivePackage(actorOf(session), {
      tag: field(formData, "tag"),
      itemId: field(formData, "itemId"),
      quantity: field(formData, "quantity"),
      locationId: field(formData, "locationId"),
      lotNumber: field(formData, "lotNumber"),
      costPerUnit: field(formData, "costPerUnit"),
      note: field(formData, "note"),
    });
    packageId = pkg.id;
  } catch (error) {
    return toFormError(error);
  }
  revalidatePath("/inventory");
  redirect(`/inventory/${packageId}`);
}

export async function moveAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.write");
    const packageId = field(formData, "packageId");
    await movePackage(actorOf(session), {
      packageId,
      toLocationId: field(formData, "toLocationId"),
      note: field(formData, "note"),
    });
    revalidatePath(`/inventory/${packageId}`);
    return { ok: "Package moved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function adjustAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.adjust");
    const packageId = field(formData, "packageId");
    await adjustPackage(actorOf(session), {
      packageId,
      newQuantity: field(formData, "newQuantity"),
      reasonCode: field(formData, "reasonCode"),
      note: field(formData, "note"),
    });
    revalidatePath(`/inventory/${packageId}`);
    return { ok: "Quantity adjusted and logged." };
  } catch (error) {
    return toFormError(error);
  }
}
