"use server";

import { revalidatePath } from "next/cache";
import { field, toFormError, type FormState } from "@/lib/form";
import { IMPORT_KINDS, importCsv, type ImportKind } from "@/lib/importer";
import { InventoryError } from "@/lib/inventory-math";
import { requirePermission } from "@/lib/session";

export async function importAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const kind = field(formData, "kind") as ImportKind;
    if (!IMPORT_KINDS[kind]) throw new InventoryError("Choose what to import.");
    const session = await requirePermission(kind === "customers" ? "sales.write" : kind === "packages" ? "inventory.write" : "catalog.manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new InventoryError("Choose a CSV file to upload.");
    if (file.size > 2 * 1024 * 1024) throw new InventoryError("The file is larger than 2 MB. Split it into smaller files.");
    const result = await importCsv(
      { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId },
      kind,
      await file.text(),
    );
    revalidatePath("/", "layout");
    return { ok: `Imported ${result.count} ${IMPORT_KINDS[kind].label.toLowerCase()} row${result.count === 1 ? "" : "s"}.` };
  } catch (error) {
    return toFormError(error);
  }
}
