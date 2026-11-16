"use server";

import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { createSession } from "@/lib/session";
import { createFirstOwner } from "@/lib/setup";

export async function setupAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    if (field(formData, "password") !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match." };
    const owner = await createFirstOwner({
      businessName: field(formData, "businessName"),
      facilityName: field(formData, "facilityName"),
      licenseNumber: field(formData, "licenseNumber"),
      licenseType: field(formData, "licenseType"),
      state: field(formData, "state"),
      ownerName: field(formData, "ownerName"),
      email: field(formData, "email"),
      password: String(formData.get("password") ?? ""),
    });
    await createSession({ ...owner, role: "OWNER" });
  } catch (error) {
    return toFormError(error);
  }
  redirect("/dashboard");
}
