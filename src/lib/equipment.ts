import { and, eq } from "drizzle-orm";
import { equipment, equipmentLogs, locations, productionRunEquipment, productionRuns } from "@/db/schema";
import { db } from "./db";
import { parseEveryDays } from "./equipment-math";
import { InventoryError, audit, type Actor } from "./inventory";
import { facilityToday } from "./time";

const text = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);

export const EVENT_KINDS = ["MAINTENANCE", "CALIBRATION", "REPAIR", "NOTE"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

async function mine(actor: Actor, equipmentId: string) {
  const [row] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.orgId, actor.orgId), eq(equipment.facilityId, actor.facilityId)));
  if (!row) throw new InventoryError("That equipment was not found at this facility.");
  return row;
}

export async function createEquipment(
  actor: Actor,
  input: { name: string; kind: string; serialNumber?: string; locationId?: string; maintenanceEveryDays?: unknown; calibrationEveryDays?: unknown; notes?: string },
): Promise<{ id: string }> {
  const name = text(input.name);
  const kind = text(input.kind, 60);
  if (!name) throw new InventoryError("Give the equipment a name, for example Rosin press 1.");
  if (!kind) throw new InventoryError("Say what kind of equipment it is, for example press, extractor, dryer or scale.");
  let maintenanceEveryDays: number | null;
  let calibrationEveryDays: number | null;
  try {
    maintenanceEveryDays = parseEveryDays(input.maintenanceEveryDays, "Maintenance schedule");
    calibrationEveryDays = parseEveryDays(input.calibrationEveryDays, "Calibration schedule");
  } catch (e) {
    throw new InventoryError(e instanceof Error ? e.message : "Check the schedules.");
  }
  return db.transaction(async (tx) => {
    let locationId: string | null = null;
    if (input.locationId) {
      const [loc] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.id, input.locationId), eq(locations.orgId, actor.orgId), eq(locations.facilityId, actor.facilityId)));
      if (!loc) throw new InventoryError("Pick a location from the list.");
      locationId = loc.id;
    }
    const [row] = await tx
      .insert(equipment)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name, kind, serialNumber: text(input.serialNumber, 80) || null, locationId, maintenanceEveryDays, calibrationEveryDays, notes: text(input.notes, 500) || null })
      .onConflictDoNothing({ target: [equipment.facilityId, equipment.name] })
      .returning({ id: equipment.id });
    if (!row) throw new InventoryError(`This facility already has equipment called ${name}.`);
    await audit(tx, actor, { entityType: "Equipment", entityId: row.id, action: "CREATE", after: { name, kind, maintenanceEveryDays, calibrationEveryDays } });
    return row;
  });
}

export async function setEquipmentStatus(actor: Actor, input: { equipmentId: string; status: string; reason?: string }): Promise<void> {
  if (!["ACTIVE", "DOWN", "RETIRED"].includes(input.status)) throw new InventoryError("Pick Active, Out of service, or Retired.");
  const row = await mine(actor, input.equipmentId);
  if (row.status === input.status) return;
  await db.transaction(async (tx) => {
    await tx.update(equipment).set({ status: input.status }).where(eq(equipment.id, row.id));
    await audit(tx, actor, { entityType: "Equipment", entityId: row.id, action: "STATUS", before: { status: row.status }, after: { status: input.status }, reason: text(input.reason, 300) || null });
  });
}

/** Record maintenance, a calibration, a repair or a note. Maintenance and calibration reset their schedule. */
export async function logEquipmentEvent(actor: Actor, input: { equipmentId: string; kind: string; doneOn?: string; note?: string }): Promise<void> {
  if (!(EVENT_KINDS as readonly string[]).includes(input.kind)) throw new InventoryError("Pick what was done.");
  const row = await mine(actor, input.equipmentId);
  const today = await facilityToday(actor.facilityId);
  const doneOn = text(input.doneOn, 10) || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn) || Number.isNaN(Date.parse(doneOn))) throw new InventoryError("Type the date as YYYY-MM-DD.");
  if (doneOn > today) throw new InventoryError("That date is in the future. Log it once it is done.");
  const note = text(input.note, 500) || null;
  if (input.kind === "NOTE" && !note) throw new InventoryError("Write the note.");
  await db.transaction(async (tx) => {
    await tx.insert(equipmentLogs).values({ equipmentId: row.id, kind: input.kind, doneOn, note, userName: actor.userName });
    // A back-dated entry never moves a schedule earlier than what is already recorded.
    if (input.kind === "MAINTENANCE" && (!row.lastMaintainedOn || doneOn > row.lastMaintainedOn)) await tx.update(equipment).set({ lastMaintainedOn: doneOn }).where(eq(equipment.id, row.id));
    if (input.kind === "CALIBRATION" && (!row.lastCalibratedOn || doneOn > row.lastCalibratedOn)) await tx.update(equipment).set({ lastCalibratedOn: doneOn }).where(eq(equipment.id, row.id));
    await audit(tx, actor, { entityType: "Equipment", entityId: row.id, action: input.kind, after: { doneOn, note } });
  });
}

/** Record that a run used a piece of equipment. Equipment that is out of service or retired cannot be added. */
export async function addEquipmentToRun(actor: Actor, input: { runId: string; equipmentId: string }): Promise<void> {
  const row = await mine(actor, input.equipmentId);
  if (row.status !== "ACTIVE") throw new InventoryError(`${row.name} is ${row.status === "DOWN" ? "out of service" : "retired"} and can't be used in a run.`);
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: productionRuns.id, status: productionRuns.status })
      .from(productionRuns)
      .where(and(eq(productionRuns.id, input.runId), eq(productionRuns.orgId, actor.orgId), eq(productionRuns.facilityId, actor.facilityId)))
      .for("update");
    if (!run) throw new InventoryError("That production run was not found at this facility.");
    if (run.status !== "IN_PROGRESS") throw new InventoryError("This run is finished, so its equipment can no longer be changed.");
    const added = await tx.insert(productionRunEquipment).values({ runId: run.id, equipmentId: row.id, userName: actor.userName }).onConflictDoNothing().returning({ runId: productionRunEquipment.runId });
    if (added.length) await audit(tx, actor, { entityType: "ProductionRun", entityId: run.id, action: "ADD_EQUIPMENT", after: { equipment: row.name } });
  });
}

export async function removeEquipmentFromRun(actor: Actor, input: { runId: string; equipmentId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: productionRuns.id, status: productionRuns.status })
      .from(productionRuns)
      .where(and(eq(productionRuns.id, input.runId), eq(productionRuns.orgId, actor.orgId), eq(productionRuns.facilityId, actor.facilityId)))
      .for("update");
    if (!run) throw new InventoryError("That production run was not found at this facility.");
    if (run.status !== "IN_PROGRESS") throw new InventoryError("This run is finished, so its equipment can no longer be changed.");
    const gone = await tx.delete(productionRunEquipment).where(and(eq(productionRunEquipment.runId, run.id), eq(productionRunEquipment.equipmentId, input.equipmentId))).returning({ id: productionRunEquipment.equipmentId });
    if (gone.length) await audit(tx, actor, { entityType: "ProductionRun", entityId: run.id, action: "REMOVE_EQUIPMENT", before: { equipmentId: input.equipmentId } });
  });
}
