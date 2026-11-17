"use server";

import { revalidatePath } from "next/cache";
import { field, toFormError, type FormState } from "@/lib/form";
import { actorOf } from "@/lib/labels/http";
import { LabelError, savePrinter } from "@/lib/labels/service";
import { requirePermission } from "@/lib/session";

export async function savePrinterAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("labels.manage");
    await savePrinter(actorOf(session), {
      id: field(formData, "id") || null,
      name: field(formData, "name"),
      offsetXMm: Number(field(formData, "offsetXMm") || 0),
      offsetYMm: Number(field(formData, "offsetYMm") || 0),
      isDefault: formData.get("isDefault") === "on",
    });
    revalidatePath("/labels/printers");
    return { ok: "Printer saved." };
  } catch (e) {
    if (e instanceof LabelError) return { error: e.message };
    return toFormError(e);
  }
}
