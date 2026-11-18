"use server";

import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { INVITE_ONLY_MESSAGE, signupsOpen } from "@/lib/access";
import { createSession } from "@/lib/session";
import { createBusiness } from "@/lib/setup";

export async function signupAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    if (!signupsOpen()) return { error: INVITE_ONLY_MESSAGE };
    // A field people never see. Bots that fill in every box get a polite no.
    if (field(formData, "website")) return { error: "Something went wrong. Please try again." };
    if (String(formData.get("password") ?? "") !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match." };
    const owner = await createBusiness(
      {
        businessName: field(formData, "businessName"),
        facilityName: field(formData, "facilityName"),
        licenseNumber: field(formData, "licenseNumber"),
        licenseType: field(formData, "licenseType"),
        state: field(formData, "state"),
        ownerName: field(formData, "ownerName"),
        email: field(formData, "email"),
        password: String(formData.get("password") ?? ""),
      },
      { onlyIfEmpty: false },
    );
    await createSession({ ...owner, role: "OWNER" });
  } catch (error) {
    return toFormError(error);
  }
  redirect("/dashboard");
}
