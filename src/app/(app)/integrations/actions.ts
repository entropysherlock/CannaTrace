"use server";

import { revalidatePath } from "next/cache";
import { field, toFormError, type FormState } from "@/lib/form";
import { createApiKey, createWebhook, revokeApiKey, setWebhookActive } from "@/lib/integrations";
import { requirePermission } from "@/lib/session";

async function owner() {
  const session = await requirePermission("integrations.manage");
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}

export async function createKeyAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const { key } = await createApiKey(await owner(), { name: field(formData, "name"), canWrite: formData.get("canWrite") === "on" });
    revalidatePath("/integrations");
    return { ok: `Copy this key now. It will not be shown again:\n${key}` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function revokeKeyAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await revokeApiKey(await owner(), { keyId: field(formData, "keyId") });
    revalidatePath("/integrations");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function createWebhookAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const { secret } = await createWebhook(await owner(), { url: field(formData, "url"), events: formData.getAll("events").map(String) });
    revalidatePath("/integrations");
    return { ok: `Webhook added. Its signing secret is shown once. Store it where the receiving system can check signatures:\n${secret}` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function toggleWebhookAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setWebhookActive(await owner(), { webhookId: field(formData, "webhookId"), active: field(formData, "active") === "true" });
    revalidatePath("/integrations");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}
