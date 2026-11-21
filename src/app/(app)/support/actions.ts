"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { InventoryError } from "@/lib/inventory-math";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { addSupportAdmin, createCustomerBusiness, isPlatformAdmin, openSupportVisit, removeSupportAdmin, setBusinessAccess } from "@/lib/platform-admin";
import { sentryDsn } from "@/lib/sentry-options";
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

/**
 * Prove crash alerts work: report a clearly-labelled test error to Sentry and wait until it is sent.
 * Platform admins only; nothing in any customer's account is touched.
 */
export async function sendTestCrashAction(): Promise<FormState> {
  try {
    const me = await admin();
    if (!(await isPlatformAdmin(me.userId))) throw new InventoryError("Only CannaTrace support can send a test crash.");
    if (!sentryDsn) throw new InventoryError("Crash alerts are off: add NEXT_PUBLIC_SENTRY_DSN in Vercel and redeploy first.");
    Sentry.captureException(new Error(`CannaTrace test crash from the Support Console (${new Date().toISOString()})`), { tags: { test: "yes" } });
    const sent = await Sentry.flush(5000);
    if (!sent) throw new InventoryError("Couldn't reach Sentry within 5 seconds. Check the DSN in Vercel.");
    return { ok: "Test crash sent. It should show in Sentry, and in your email, within a minute." };
  } catch (error) {
    return toFormError(error);
  }
}

/** Suspend or restore a business's access (Support Console). */
export async function businessAccessAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const action = field(formData, "access") === "suspend" ? "suspend" : "approve";
    const message = await setBusinessAccess(await admin(), field(formData, "orgId"), action, field(formData, "reason"));
    revalidatePath("/support");
    return { ok: message };
  } catch (error) {
    return toFormError(error);
  }
}
