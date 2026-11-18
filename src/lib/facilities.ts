import "server-only";
import { and, eq } from "drizzle-orm";
import { auditLogs, facilities, licenseTypeEnum, locations, organizations } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";
import { isRoomArea, roomAreaLabel } from "./rooms";
import { isSupportedState } from "./states";

export type FacilityActor = { orgId: string; userId: string; userName: string; facilityId: string };
export type FacilityInput = { name: string; licenseNumber: string; licenseType: string; state: string };

function clean(input: FacilityInput, keepState?: string) {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new InventoryError("Enter the facility's name.");
  const licenseNumber = input.licenseNumber.trim().toUpperCase().slice(0, 60);
  if (!licenseNumber) throw new InventoryError("Enter the facility's state license number.");
  if (!(licenseTypeEnum.enumValues as readonly string[]).includes(input.licenseType)) throw new InventoryError("Choose a license type.");
  const state = input.state.trim().toUpperCase();
  // A facility may keep a state it already had; new choices must be a state CannaTrace supports.
  if (!isSupportedState(state) && state !== keepState) throw new InventoryError("Choose one of the listed states. CannaTrace only supports states with legal adult-use sales and built-in rules.");
  return { name, licenseNumber, licenseType: input.licenseType as (typeof licenseTypeEnum.enumValues)[number], state };
}

const duplicate = (e: unknown) => String((e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code) === "23505";

export async function addFacility(actor: FacilityActor, input: FacilityInput) {
  const values = clean(input);
  try {
    const [f] = await db.insert(facilities).values({ orgId: actor.orgId, ...values }).returning();
    await db.insert(auditLogs).values({ orgId: actor.orgId, facilityId: f.id, userId: actor.userId, userName: actor.userName, entityType: "facility", entityId: f.id, action: "facility.added", after: values });
    return f;
  } catch (e) {
    if (duplicate(e)) throw new InventoryError(`License ${values.licenseNumber} is already on another facility.`);
    throw e;
  }
}

/** Changing the state switches which state's rules CannaTrace enforces at that facility from then on. */
export async function updateFacility(actor: FacilityActor, facilityId: string, input: FacilityInput) {
  const [before] = await db.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.orgId, actor.orgId)));
  if (!before) throw new InventoryError("That facility was not found.");
  const values = clean(input, before.state);
  try {
    await db.update(facilities).set(values).where(eq(facilities.id, facilityId));
  } catch (e) {
    if (duplicate(e)) throw new InventoryError(`License ${values.licenseNumber} is already on another facility.`);
    throw e;
  }
  await db.insert(auditLogs).values({
    orgId: actor.orgId,
    facilityId,
    userId: actor.userId,
    userName: actor.userName,
    entityType: "facility",
    entityId: facilityId,
    action: before.state !== values.state ? "facility.state_changed" : "facility.updated",
    before: { name: before.name, licenseNumber: before.licenseNumber, licenseType: before.licenseType, state: before.state },
    after: values,
  });
  return { stateChanged: before.state !== values.state };
}

/** Change the business's own name (not a facility's). */
export async function renameBusiness(actor: FacilityActor, input: string): Promise<string> {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name) throw new InventoryError("Enter the business name.");
  if (name.length > 100) throw new InventoryError("Keep the business name under 100 characters.");
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.orgId));
    if (!before || before.name === name) return;
    await tx.update(organizations).set({ name }).where(eq(organizations.id, actor.orgId));
    await tx.insert(auditLogs).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      userId: actor.userId,
      userName: actor.userName,
      entityType: "Business",
      entityId: actor.orgId,
      action: "RENAME",
      before: { name: before.name },
      after: { name },
    });
  });
  return name;
}

export type RoomInput = { area: string; name: string };

function cleanRoom(input: RoomInput) {
  if (!isRoomArea(input.area)) throw new InventoryError("Choose a room area type.");
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new InventoryError("Enter a name for the room.");
  return { area: input.area, name };
}

async function facilityInOrg(actor: FacilityActor, facilityId: string) {
  const [f] = await db.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.orgId, actor.orgId)));
  if (!f) throw new InventoryError("That facility was not found.");
  return f;
}

/** A room is a ROOM location with an area type. It shows up anywhere the facility's locations are listed. */
export async function addRoom(actor: FacilityActor, facilityId: string, input: RoomInput) {
  const values = cleanRoom(input);
  await facilityInOrg(actor, facilityId);
  return db.transaction(async (tx) => {
    const [room] = await tx
      .insert(locations)
      .values({ orgId: actor.orgId, facilityId, name: values.name, type: "ROOM", area: values.area })
      .onConflictDoNothing({ target: [locations.facilityId, locations.name] })
      .returning();
    if (!room) throw new InventoryError(`This facility already has a room or location called ${values.name}.`);
    await tx.insert(auditLogs).values({
      orgId: actor.orgId,
      facilityId,
      userId: actor.userId,
      userName: actor.userName,
      entityType: "Location",
      entityId: room.id,
      action: "CREATE",
      after: { name: values.name, type: "ROOM", area: roomAreaLabel(values.area) },
    });
    return room;
  });
}

export async function updateRoom(actor: FacilityActor, roomId: string, input: RoomInput) {
  const values = cleanRoom(input);
  const [before] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, roomId), eq(locations.orgId, actor.orgId), eq(locations.type, "ROOM")));
  if (!before) throw new InventoryError("That room was not found.");
  try {
    await db.transaction(async (tx) => {
      await tx.update(locations).set(values).where(eq(locations.id, roomId));
      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        facilityId: before.facilityId,
        userId: actor.userId,
        userName: actor.userName,
        entityType: "Location",
        entityId: roomId,
        action: "UPDATE",
        before: { name: before.name, area: roomAreaLabel(before.area) },
        after: { name: values.name, area: roomAreaLabel(values.area) },
      });
    });
  } catch (e) {
    if (duplicate(e)) throw new InventoryError(`This facility already has a room or location called ${values.name}.`);
    throw e;
  }
  return { ...before, ...values };
}
