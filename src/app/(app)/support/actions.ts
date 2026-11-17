"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { InventoryError } from "@/lib/inventory-math";
import { addSupportAdmin, openSupportVisit, removeSupportAdmin } from "@/lib/platform-admin";
import { createSession, requireSession } from "@/lib/session";

async function admin() {
  const session = await requireSession();
  if (session.support) throw new InventoryError("Leave the customer's account first (Exit support view at the top).");
  return { userId: session.userId, orgId: session.orgId, facilityId: session.facilityId, name: session.name };
}

export async function openAccountAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const token = await openSupportVisit(await admin(), field(formData, "orgId"), field(formData, "reason"));
    await createSession(token);
  } catch (error) {
    return toFormError(error);
  }
  redirect("/dashboard");
}

export async function addAdminAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = await addSupportAdmin(await admin(), field(formData, "email"));
    revalidatePath("/support");
    return { ok: `${name} can now use the support console.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function removeAdminAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await removeSupportAdmin(await admin(), field(formData, "userId"));
    revalidatePath("/support");
    return { ok: "Support access removed." };
  } catch (error) {
    return toFormError(error);
  }
}
