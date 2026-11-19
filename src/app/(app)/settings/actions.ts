"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { facilities, users } from "@/db/schema";
import { canUseFacility } from "@/lib/facility-access";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { addFacility, addRoom, renameBusiness, setFacilityHidden, updateFacility, updateRoom } from "@/lib/facilities";
import { roomAreaLabel } from "@/lib/rooms";
import { field, toFormError, type FormState } from "@/lib/form";
import { createSession, requirePermission, requireSession } from "@/lib/session";
import { stateName } from "@/lib/states";
import { loadSampleFacility } from "@/lib/demo/sample-facility";

export async function switchFacility(formData: FormData): Promise<void> {
  const session = await requireSession();
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, field(formData, "facilityId")), eq(facilities.orgId, session.orgId)));
  if (facility && canUseFacility(session, facility.id)) {
    await createSession({ ...session, facilityId: facility.id });
    // Remember it, so signing in next time comes back here.
    if (!session.support) await db.update(users).set({ lastFacilityId: facility.id }).where(eq(users.id, session.userId));
  }
  redirect("/dashboard");
}

function facilityInput(formData: FormData) {
  return {
    name: field(formData, "name"),
    licenseNumber: field(formData, "licenseNumber"),
    licenseType: field(formData, "licenseType"),
    state: field(formData, "state"),
  };
}

export async function addFacilityAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("settings.manage");
    const f = await addFacility({ orgId: session.orgId, userId: session.userId, userName: session.name, facilityId: session.facilityId }, facilityInput(formData));
    revalidatePath("/", "layout");
    return { ok: `Added ${f.name}. Switch to it from the facility menu at the top to start using it.` };
  } catch (e) {
    return toFormError(e);
  }
}

export async function updateFacilityAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("settings.manage");
    const { stateChanged } = await updateFacility(
      { orgId: session.orgId, userId: session.userId, userName: session.name, facilityId: session.facilityId },
      field(formData, "facilityId"),
      facilityInput(formData),
    );
    revalidatePath("/", "layout");
    return { ok: stateChanged ? `Saved. ${stateName(field(formData, "state"))}'s rules apply to this facility from now on.` : "Saved." };
  } catch (e) {
    return toFormError(e);
  }
}

export async function renameBusinessAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("settings.manage");
    const name = await renameBusiness({ orgId: session.orgId, userId: session.userId, userName: session.name, facilityId: session.facilityId }, field(formData, "name"));
    revalidatePath("/", "layout");
    return { ok: `Saved. Your business is now called ${name}.` };
  } catch (e) {
    return toFormError(e);
  }
}

const actorOf = (session: { orgId: string; userId: string; name: string; facilityId: string }) => ({
  orgId: session.orgId,
  userId: session.userId,
  userName: session.name,
  facilityId: session.facilityId,
});

const roomInput = (formData: FormData) => ({ area: field(formData, "area"), name: field(formData, "name") });

export async function addRoomAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("settings.manage");
    const room = await addRoom(actorOf(session), field(formData, "facilityId"), roomInput(formData));
    revalidatePath("/settings/facilities");
    revalidatePath("/locations");
    return { ok: `Added ${room.name} (${roomAreaLabel(room.area)}).` };
  } catch (e) {
    return toFormError(e);
  }
}

export async function updateRoomAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("settings.manage");
    const room = await updateRoom(actorOf(session), field(formData, "roomId"), roomInput(formData));
    revalidatePath("/settings/facilities");
    revalidatePath("/locations");
    return { ok: `Saved ${room.name} (${roomAreaLabel(room.area)}).` };
  } catch (e) {
    return toFormError(e);
  }
}

export async function loadSampleFacilityAction(): Promise<FormState> {
  try {
    const session = await requirePermission("settings.manage");
    if (session.role !== "OWNER") return { error: "Only an owner can load sample data." };
    if (session.isDemo) return { error: "The live demo already is sample data." };
    const { summary } = await loadSampleFacility({ orgId: session.orgId, userId: session.userId, userName: session.name });
    revalidatePath("/", "layout");
    return { ok: `${summary} Switch to it from its card below or the facility menu at the top.` };
  } catch (e) {
    return toFormError(e);
  }
}

/** Hide a facility from the menu and Dashboard, or show it again. Nothing is deleted. */
export async function setFacilityHiddenAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  await setFacilityHidden(actorOf(session), field(formData, "facilityId"), field(formData, "hidden") === "1").catch(() => {});
  revalidatePath("/", "layout");
  redirect("/settings/facilities");
}
