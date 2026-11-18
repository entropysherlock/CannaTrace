"use server";

import { revalidatePath } from "next/cache";
import { field, toFormError, type FormState } from "@/lib/form";
import { IMPORT_KINDS, importCsv, type ImportKind } from "@/lib/importer";
import { InventoryError } from "@/lib/inventory-math";
import { importInventory, previewImport, readReport, type DutchieResult } from "@/lib/importers/dutchie";
import { isSource, SOURCE_NAME, type Source } from "@/lib/importers/dutchie-parse";
import { can } from "@/lib/rbac";
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

export type DutchieState = { error?: string; preview?: DutchieResult; imported?: DutchieResult } | null;

async function dutchieInput(formData: FormData) {
  const session = await requirePermission("inventory.write");
  if (!can(session, "catalog.manage")) throw new InventoryError("Switching systems also adds products, so it needs permission to manage items. Ask an owner or manager.");
  const raw = field(formData, "source");
  const source: Source = isSource(raw) ? raw : "dutchie";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new InventoryError(`Choose the inventory file you exported from ${SOURCE_NAME[source]}.`);
  const table = await readReport(file.name, Buffer.from(await file.arrayBuffer()));
  const store = field(formData, "store") || undefined;
  return { source, store, actor: { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }, table };
}

/** Check the report and show what would come in. Nothing is saved. */
export async function previewDutchieAction(formData: FormData): Promise<DutchieState> {
  try {
    const { source, store, actor, table } = await dutchieInput(formData);
    return { preview: await previewImport(source, actor, table, store) };
  } catch (error) {
    return { error: toFormError(error)?.error };
  }
}

export async function importDutchieAction(formData: FormData): Promise<DutchieState> {
  try {
    const { source, store, actor, table } = await dutchieInput(formData);
    const imported = await importInventory(source, actor, table, store);
    revalidatePath("/", "layout");
    return { imported };
  } catch (error) {
    return { error: toFormError(error)?.error };
  }
}
