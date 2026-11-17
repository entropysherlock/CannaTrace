import "server-only";
import { and, eq } from "drizzle-orm";
import { auditLogs, facilities, licenseTypeEnum } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";
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
