"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { createPairing, revokeDevice } from "@/lib/devices";
import { toFormError, type FormState } from "@/lib/form";
import { createSession, requireSession } from "@/lib/session";
import { changeOwnPassword } from "@/lib/team";
import { beginSetup, confirmSetup, newRecoveryCodes, turnOff } from "@/lib/two-factor";

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

/** Turns the daily morning-brief email on or off for the signed-in person. */
export async function setMorningBriefAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireSession();
    if (session.support || session.isDemo) return { error: "The morning brief isn't available here." };
    const on = formData.get("on") === "on";
    await db.update(users).set({ morningBrief: on }).where(and(eq(users.id, session.userId), eq(users.orgId, session.orgId)));
    revalidatePath("/account");
    return { ok: on ? "Morning brief is on. It arrives by email each morning." : "Morning brief is off." };
  } catch (error) {
    return toFormError(error);
  }
}

// ---------- Two-step sign-in ----------

type TwoFactorResult = { error?: string; svg?: string; key?: string; recoveryCodes?: string[]; done?: boolean };
const failed = (error: unknown): TwoFactorResult => {
  const f = toFormError(error);
  return { error: f && "error" in f && f.error ? f.error : "Something went wrong." };
};

/** Step 1 of turning on two-step sign-in: a QR code for the authenticator app, and the same secret as text. */
export async function beginTwoFactorAction(): Promise<TwoFactorResult> {
  try {
    const { otpauth, key } = await beginSetup(await requireSession());
    return { svg: await QRCode.toString(otpauth, { type: "svg", margin: 1, width: 192, errorCorrectionLevel: "M" }), key };
  } catch (error) {
    return failed(error);
  }
}

/** Step 2: the first code from the app. If it is right, two-step is on and the recovery codes come back (shown once). */
export async function confirmTwoFactorAction(code: string): Promise<TwoFactorResult> {
  try {
    const { recoveryCodes } = await confirmSetup(await requireSession(), code);
    revalidatePath("/account");
    return { recoveryCodes };
  } catch (error) {
    return failed(error);
  }
}

export async function turnOffTwoFactorAction(password: string, code: string): Promise<TwoFactorResult> {
  try {
    await turnOff(await requireSession(), { password, code });
    revalidatePath("/account");
    return { done: true };
  } catch (error) {
    return failed(error);
  }
}

export async function newRecoveryCodesAction(password: string, code: string): Promise<TwoFactorResult> {
  try {
    const { recoveryCodes } = await newRecoveryCodes(await requireSession(), { password, code });
    revalidatePath("/account");
    return { recoveryCodes };
  } catch (error) {
    return failed(error);
  }
}
