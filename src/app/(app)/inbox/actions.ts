"use server";

import { revalidatePath } from "next/cache";
import { toFormError } from "@/lib/form";
import { confirmCoa, dismissScan } from "@/lib/scan/read";
import type { CoaValues } from "@/lib/scan/types";
import { requireSession } from "@/lib/session";

export type ConfirmResult = { ok: true; resultId: string; packageId: string; quarantined: boolean } | { ok: false; error: string };

export async function confirmCoaAction(input: { attachmentId: string; packageId: string; values: Partial<CoaValues> }): Promise<ConfirmResult> {
  try {
    const session = await requireSession();
    const saved = await confirmCoa(session, input);
    // Not "/inbox": that would swap this review page for "already saved" before the person sees the success screen.
    revalidatePath("/inventory");
    return { ok: true, resultId: saved.resultId, packageId: input.packageId, quarantined: saved.quarantined };
  } catch (error) {
    const failed = toFormError(error);
    return { ok: false, error: failed && "error" in failed && failed.error ? failed.error : "That couldn't be saved." };
  }
}

export async function dismissScanAction(attachmentId: string): Promise<void> {
  await dismissScan(await requireSession(), attachmentId);
  revalidatePath("/inbox");
}
