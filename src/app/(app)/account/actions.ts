"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { createPairing, revokeDevice } from "@/lib/devices";
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

/** A one-time link and its QR code, to scan with the phone being linked. */
export async function makePairingAction(): Promise<{ error?: string; url?: string; svg?: string; minutes?: number }> {
  try {
    const session = await requireSession();
    const { code } = await createPairing(session);
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const url = `${origin}/link/${code}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 224, errorCorrectionLevel: "M" });
    return { url, svg, minutes: 10 };
  } catch (error) {
    const failed = toFormError(error);
    return { error: failed && "error" in failed && failed.error ? failed.error : "Could not make a code." };
  }
}

export async function revokePhoneAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await revokeDevice(await requireSession(), String(formData.get("id") ?? ""));
    revalidatePath("/account");
    return { ok: "Phone unlinked." };
  } catch (error) {
    return toFormError(error);
  }
}
