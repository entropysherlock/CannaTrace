"use server";

import { revalidatePath } from "next/cache";
import { setAutomationMode, setAutomationPaused } from "@/lib/automation";
import { field, toFormError, type FormState } from "@/lib/form";
import { requirePermission } from "@/lib/session";

async function manager() {
  const s = await requirePermission("settings.manage");
  return { userId: s.userId, userName: s.name, orgId: s.orgId, facilityId: s.facilityId };
}

export async function automationModeAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await setAutomationMode(await manager(), { kind: field(formData, "kind"), mode: field(formData, "mode"), hourlyCap: field(formData, "hourlyCap") });
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function automationPauseAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const paused = field(formData, "paused") === "true";
    await setAutomationPaused(await manager(), { paused, reason: field(formData, "reason") });
    revalidatePath("/", "layout");
    return { ok: paused ? "Automation is paused." : "Automation is running again." };
  } catch (error) {
    return toFormError(error);
  }
}
