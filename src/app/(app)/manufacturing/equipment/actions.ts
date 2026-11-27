"use server";

import { revalidatePath } from "next/cache";
import { createEquipment, logEquipmentEvent, removeEquipmentFromRun, setEquipmentStatus, addEquipmentToRun } from "@/lib/equipment";
import { field, toFormError, type FormState } from "@/lib/form";
import type { Actor } from "@/lib/inventory";
import { requirePermission } from "@/lib/session";

async function maker(): Promise<Actor> {
  const s = await requirePermission("manufacturing.write");
  return { userId: s.userId, userName: s.name, orgId: s.orgId, facilityId: s.facilityId };
}
const refresh = () => revalidatePath("/manufacturing", "layout");

export async function createEquipmentAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = field(formData, "name");
    await createEquipment(await maker(), {
      name,
      kind: field(formData, "kind"),
      serialNumber: field(formData, "serialNumber"),
      locationId: field(formData, "locationId"),
      maintenanceEveryDays: field(formData, "maintenanceEveryDays"),
      calibrationEveryDays: field(formData, "calibrationEveryDays"),
      notes: field(formData, "notes"),
    });
    refresh();
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function logEventAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await logEquipmentEvent(await maker(), { equipmentId: field(formData, "equipmentId"), kind: field(formData, "kind"), doneOn: field(formData, "doneOn"), note: field(formData, "note") });
    refresh();
    return { ok: "Logged." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function equipmentStatusAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await setEquipmentStatus(await maker(), { equipmentId: field(formData, "equipmentId"), status: field(formData, "status"), reason: field(formData, "reason") });
    refresh();
    return { ok: "Status saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function runEquipmentAddAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await addEquipmentToRun(await maker(), { runId: field(formData, "runId"), equipmentId: field(formData, "equipmentId") });
    refresh();
    return { ok: "Added to this run." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function runEquipmentRemoveAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await removeEquipmentFromRun(await maker(), { runId: field(formData, "runId"), equipmentId: field(formData, "equipmentId") });
    refresh();
    return { ok: "Removed from this run." };
  } catch (error) {
    return toFormError(error);
  }
}
