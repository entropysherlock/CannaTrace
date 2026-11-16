"use server";

import { revalidatePath } from "next/cache";
import { field, toFormError, type FormState } from "@/lib/form";
import { processQueue, resolveEvent, retryEvent, setFacilitySystem } from "@/lib/sync";
import { requirePermission } from "@/lib/session";

async function manager() {
  const session = await requirePermission("compliance.manage");
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}
const refresh = () => {
  revalidatePath("/compliance");
  revalidatePath("/dashboard");
};

export async function sendNowAction(): Promise<FormState> {
  try {
    const actor = await manager();
    const r = await processQueue({ facilityId: actor.facilityId });
    refresh();
    const parts = [
      r.sent && `${r.sent} sent`,
      r.manual && `${r.manual} need entering by hand`,
      r.retrying && `${r.retrying} will be retried`,
      r.failed && `${r.failed} failed`,
      r.blocked && "waiting behind a failed record",
    ].filter(Boolean);
    return { ok: parts.length ? `Done: ${parts.join(", ")}.` : "Nothing was due to send." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function retryAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await manager();
    await retryEvent(actor, { eventId: field(formData, "eventId") });
    await processQueue({ facilityId: actor.facilityId });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function resolveAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await resolveEvent(await manager(), { eventId: field(formData, "eventId"), note: field(formData, "note") });
    refresh();
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function systemAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await setFacilitySystem(await manager(), { system: field(formData, "system") });
    refresh();
    return { ok: "Saved. Records from now on go to the system you chose." };
  } catch (error) {
    return toFormError(error);
  }
}
