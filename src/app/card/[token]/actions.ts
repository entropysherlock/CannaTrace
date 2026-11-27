"use server";

import { revalidatePath } from "next/cache";
import { cardConsent } from "@/lib/loyalty";
import type { FormState } from "@/lib/form";

/** A shopper changes their own email or text choice from their card page. */
export async function cardConsentAction(_state: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const channel = formData.get("channel") === "SMS" ? "SMS" : "EMAIL";
  const agreed = formData.get("agreed") === "yes";
  const ok = await cardConsent(token, { channel, agreed, method: formData.get("via") === "unsubscribe" ? "UNSUBSCRIBE" : "CARD" });
  if (!ok) return { error: agreed && channel === "EMAIL" ? "Ask the store to add your email first." : "That link isn't valid." };
  revalidatePath(`/card/${token}`);
  return { ok: agreed ? "You're signed up. You can change this any time." : "Done. You won't get these messages." };
}
