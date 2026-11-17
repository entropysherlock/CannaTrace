"use server";

import { toFormError, type FormState } from "@/lib/form";
import { createSession, requireSession } from "@/lib/session";
import { changeOwnPassword } from "@/lib/team";

export async function changePasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireSession();
    const next = String(formData.get("next") ?? "");
    if (next !== String(formData.get("confirm") ?? "")) return { error: "The two new passwords do not match." };
    await changeOwnPassword(session, { current: String(formData.get("current") ?? ""), next });
    // Keep this device signed in; every other sign-in for this account stops working.
    await createSession({ userId: session.userId, orgId: session.orgId, facilityId: session.facilityId, role: session.role, name: session.name });
    return { ok: "Password changed. You've been signed out everywhere else." };
  } catch (error) {
    return toFormError(error);
  }
}
