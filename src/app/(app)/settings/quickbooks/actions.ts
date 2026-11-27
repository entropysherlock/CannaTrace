"use server";

import { revalidatePath } from "next/cache";
import { field, toFormError, type FormState } from "@/lib/form";
import { disconnectQuickbooks, syncQuickbooks } from "@/lib/quickbooks";
import { requirePermission } from "@/lib/session";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function syncNowAction(_state?: FormState): Promise<FormState> {
  try {
    const session = await requirePermission("settings.manage");
    const r = await syncQuickbooks(session.orgId);
    revalidatePath("/settings/quickbooks");
    if (r.failed > 0 && r.invoices + r.payments === 0) return { error: `Nothing was sent. ${r.firstError ?? ""}`.trim() };
    return { ok: `Sent ${r.invoices} invoice${r.invoices === 1 ? "" : "s"} and ${r.payments} payment${r.payments === 1 ? "" : "s"}.${r.failed ? ` ${r.failed} could not be sent: ${r.firstError}` : ""}` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function disconnectQuickbooksAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    if (field(formData, "confirm").toLowerCase() !== "disconnect") return { error: 'Type "disconnect" to confirm.' };
    await disconnectQuickbooks(await requirePermission("settings.manage"));
    revalidatePath("/settings/quickbooks");
    return { ok: "Disconnected. Nothing already in QuickBooks was changed." };
  } catch (error) {
    return toFormError(error);
  }
}
