"use server";

import { redirect } from "next/navigation";
import { toFormError, type FormState } from "@/lib/form";
import { destroySession } from "@/lib/session";
import { completeReset } from "@/lib/team";

export async function resetPasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const password = String(formData.get("password") ?? "");
    if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match." };
    await completeReset(String(formData.get("token") ?? ""), password);
    // Whoever was signed in on this browser is signed out; the person signs in with the new password.
    await destroySession();
  } catch (error) {
    return toFormError(error);
  }
  redirect("/login?reset=1");
}
