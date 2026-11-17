"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { InventoryError } from "@/lib/inventory-math";
import { headers } from "next/headers";
import { addSupportAdmin, createCustomerBusiness, openSupportVisit, removeSupportAdmin } from "@/lib/platform-admin";
import { createSession, requireSession } from "@/lib/session";

async function admin() {
  const session = await requireSession();
  if (session.support) throw new InventoryError("Leave the customer's account first (Exit support view at the top).");
  return { userId: session.userId, orgId: session.orgId, facilityId: session.facilityId, name: session.name };
}

export async function openAccountAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const token = await openSupportVisit(await admin(), field(formData, "orgId"), field(formData, "reason"), field(formData, "facilityId") || undefined);
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

export async function createBusinessAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const made = await createCustomerBusiness(await admin(), {
      businessName: field(formData, "businessName"),
      facilityName: field(formData, "facilityName"),
      licenseNumber: field(formData, "licenseNumber"),
      licenseType: field(formData, "licenseType"),
      state: field(formData, "state"),
      ownerEmail: field(formData, "ownerEmail"),
    });
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    revalidatePath("/support");
    return {
      ok: `Created ${made.businessName}. It is in the list below, and you can open it now.\nSend this link to ${made.ownerEmail} so they can set their password (works once, for 7 days):\n${origin}/invite/${made.inviteToken}`,
    };
  } catch (error) {
    return toFormError(error);
  }
}
