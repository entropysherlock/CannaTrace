"use server";

import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { createSession } from "@/lib/session";
import { acceptInvite } from "@/lib/team";

export async function acceptInviteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    if (String(formData.get("password") ?? "") !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match." };
    const session = await acceptInvite(field(formData, "token"), { name: field(formData, "name"), password: String(formData.get("password") ?? "") });
    await createSession(session);
  } catch (error) {
    return toFormError(error);
  }
  redirect("/dashboard");
}
