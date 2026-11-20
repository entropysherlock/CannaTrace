"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE, DEVICE_DAYS, redeemPairing } from "@/lib/devices";
import { createSession } from "@/lib/session";

/** The person on the phone confirmed: link it, keep the phone's token, and sign it in. */
export async function linkPhoneAction(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "");
  const result = await redeemPairing(code, (await headers()).get("user-agent"));
  if (!result) redirect(`/link/${encodeURIComponent(code)}`);
  (await cookies()).set(DEVICE_COOKIE, result.deviceToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_DAYS * 86_400,
  });
  await createSession(result.user);
  redirect("/capture?linked=1");
}
