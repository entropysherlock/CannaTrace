"use server";

import { revalidatePath } from "next/cache";
import { field, toFormError, type FormState } from "@/lib/form";
import { InventoryError } from "@/lib/inventory-math";
import { requirePermission, requireSession } from "@/lib/session";
import { dismissFinding, saveStateReport, sweepFacility } from "@/lib/watch";

export async function uploadStateReportAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("compliance.view");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new InventoryError("Choose the CSV exported from the state system.");
    if (file.size > 5 * 1024 * 1024) throw new InventoryError("The file is larger than 5 MB.");
    const { packages } = await saveStateReport(session, { fileName: file.name, text: await file.text() });
    revalidatePath("/", "layout");
    return { ok: `Compared ${packages.toLocaleString("en-US")} state packages with Leaf2Sale. Differences are listed in Tally Watch.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function sweepNowAction(): Promise<void> {
  const session = await requireSession();
  await sweepFacility(session);
  revalidatePath("/", "layout");
}

export async function dismissAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireSession();
    await dismissFinding(session, field(formData, "id"));
    revalidatePath("/", "layout");
    return { ok: "Dismissed. It comes back if the problem changes." };
  } catch (error) {
    return toFormError(error);
  }
}
