// Project Apex II: authorization regressions. APEX-11 (delegated-manager escalation) and APEX-12 (cross-facility edits).
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, locations, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addFacility, addRoom, renameBusiness, setFacilityHidden, updateFacility, updateRoom, type FacilityActor } from "@/lib/facilities";
import { InventoryError } from "@/lib/inventory-math";
import { ROOM_AREAS } from "@/lib/rooms";
import { ROLE_LABELS, permissionsFor, type Permission, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { createBusiness } from "@/lib/setup";
import { changeUserRole, createInvite, createPasswordReset, deleteCustomRole, saveCustomRole, setUserActive, setUserFacilities } from "@/lib/team";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = Date.now().toString(36);
const PASSWORD = "a-long-test-password";

let owner: Session;
let facA: string;
let facB: string;
let roleId: string;
let delegate: Session; // custom role: users.manage + inventory.view + pos.use, all facilities
let restrictedDelegate: Session; // same, but limited to facility A
let manager: { id: string };
let budtender: { id: string };
let viewerRoleId: string;
let viewer: { id: string };
let restrictedStaff: { id: string };

async function person(role: Role, name: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db.insert(users).values({ orgId: owner.orgId, email: `${name}-${run}@authz.test`, name, passwordHash: "x", role, ...extra }).returning();
  return u;
}

const asCustom = (u: { id: string; name: string }, facilityId: string, facilityIds: string[] | null): Session => ({
  userId: u.id, orgId: owner.orgId, facilityId, name: u.name, role: "READ_ONLY", customRoleId: roleId,
  permissions: ["users.manage", "inventory.view", "pos.use"] as Permission[], roleName: "Delegate", facilityIds,
});

const actorOf = (s: Session): FacilityActor => ({ orgId: s.orgId, userId: s.userId, userName: s.name, facilityId: s.facilityId, role: s.role, customRoleId: s.customRoleId, facilityIds: s.facilityIds ?? null });

describe.skipIf(!hasDb)("Apex II authorization", () => {
  beforeAll(async () => {
    const b = await createBusiness({ businessName: `Authz ${run}`, facilityName: "A", licenseNumber: `AZ-A-${run}`, licenseType: "RETAIL", state: "NM", ownerName: "Own", email: `owner-${run}@authz.test`, password: PASSWORD }, { onlyIfEmpty: false });
    owner = { ...b, role: "OWNER", customRoleId: null, permissions: permissionsFor("OWNER"), roleName: ROLE_LABELS.OWNER };
    facA = owner.facilityId;
    facB = (await addFacility(actorOf(owner), { name: "B", licenseNumber: `AZ-B-${run}`, licenseType: "RETAIL", state: "NM" })).id;
    roleId = await saveCustomRole(owner, { name: "Delegate", description: "", permissions: ["users.manage", "inventory.view", "pos.use"] });
    const d = await person("READ_ONLY", "delegate", { customRoleId: roleId });
    const rd = await person("READ_ONLY", "rdelegate", { customRoleId: roleId, facilityIds: [facA] });
    delegate = asCustom(d, facA, null);
    restrictedDelegate = asCustom(rd, facA, [facA]);
    manager = await person("MANAGER", "mgr");
    budtender = await person("BUDTENDER", "bud");
    viewerRoleId = await saveCustomRole(owner, { name: "Viewer", description: "", permissions: ["inventory.view"] });
    viewer = await person("READ_ONLY", "viewer", { customRoleId: viewerRoleId });
    restrictedStaff = await person("MANAGER", "rstaff", { facilityIds: [facA] });
  });
  afterAll(() => pool.end());

  it("APEX-11: a delegated manager cannot give someone a role that can do more than their own", async () => {
    await expect(changeUserRole(delegate, viewer.id, "builtin:MANAGER")).rejects.toThrow(/no more than yours/);
    await expect(createInvite(delegate, { email: `x1-${run}@authz.test`, roleChoice: "builtin:MANAGER" })).rejects.toThrow(/no more than yours/);
    // A role inside their own powers is allowed.
    await changeUserRole(delegate, viewer.id, `custom:${viewerRoleId}`);
    const invite = await createInvite(delegate, { email: `x3-${run}@authz.test`, roleChoice: `custom:${viewerRoleId}` });
    expect(invite.token).toBeTruthy();
  });

  it("APEX-11: a delegated manager cannot take over, deactivate or reset an account that can do more than theirs", async () => {
    await expect(createPasswordReset(delegate, manager.id)).rejects.toThrow(/cannot, so only an owner/);
    await expect(setUserActive(delegate, manager.id, false)).rejects.toThrow(/only an owner/);
    await expect(changeUserRole(delegate, manager.id, "builtin:BUDTENDER")).rejects.toThrow(/only an owner/);
    const [still] = await db.select().from(users).where(eq(users.id, manager.id));
    expect(still.role).toBe("MANAGER");
    expect(still.active).toBe(true);
  });

  it("APEX-11: a delegated manager can still look after people whose access is within their own", async () => {
    const low = await person("READ_ONLY", "low", { customRoleId: viewerRoleId });
    const r = await createPasswordReset(delegate, low.id);
    expect(r.name).toBe("low");
    await setUserActive(delegate, low.id, false);
    await setUserActive(delegate, low.id, true);
  });

  it("APEX-11: a delegated manager cannot build or edit a role that does more than their own", async () => {
    await expect(saveCustomRole(delegate, { name: `Big ${run}`, description: "", permissions: ["inventory.view", "settings.manage"] })).rejects.toThrow(/no more than yours/);
    const bigId = await saveCustomRole(owner, { name: `Wide ${run}`, description: "", permissions: ["inventory.view", "settings.manage"] });
    await expect(saveCustomRole(delegate, { id: bigId, name: `Wide ${run}`, description: "", permissions: ["inventory.view"] })).rejects.toThrow(/only an owner/);
    await expect(deleteCustomRole(delegate, bigId)).rejects.toThrow(/only an owner/);
    const small = await saveCustomRole(delegate, { name: `Small ${run}`, description: "", permissions: ["inventory.view"] });
    expect(small).toBeTruthy();
  });

  it("APEX-11: facility reach cannot be widened or managed beyond your own", async () => {
    await expect(setUserFacilities(restrictedDelegate, restrictedStaff.id, [])).rejects.toThrow();
    await expect(createInvite(restrictedDelegate, { email: `x2-${run}@authz.test`, roleChoice: "builtin:READ_ONLY" })).rejects.toThrow(InventoryError);
    const onB = await person("READ_ONLY", "onb", { customRoleId: viewerRoleId, facilityIds: [facB] });
    await expect(createPasswordReset(restrictedDelegate, onB.id)).rejects.toThrow(/facilities you do not/);
    const low = await person("READ_ONLY", "low2", { customRoleId: viewerRoleId, facilityIds: [facA] });
    await expect(setUserFacilities(restrictedDelegate, low.id, [facB])).rejects.toThrow(/facilities you work at/);
    await setUserFacilities(restrictedDelegate, low.id, [facA]);
  });

  it("APEX-12: staff limited to facility A cannot edit, hide or add rooms to facility B", async () => {
    const staff = (await db.select().from(users).where(eq(users.id, restrictedStaff.id)))[0];
    const actor: FacilityActor = { orgId: owner.orgId, userId: staff.id, userName: staff.name, facilityId: facA, role: "MANAGER", customRoleId: null, facilityIds: [facA] };
    const input = { name: "Hijacked", licenseNumber: `AZ-B-${run}`, licenseType: "RETAIL", state: "NM" };
    await expect(updateFacility(actor, facB, input)).rejects.toThrow(/not found/);
    await expect(setFacilityHidden(actor, facB, true)).rejects.toThrow(/not found/);
    await expect(addRoom(actor, facB, { area: ROOM_AREAS[0].value, name: "Backdoor" })).rejects.toThrow(/not found/);
    const [b] = await db.select().from(facilities).where(eq(facilities.id, facB));
    expect(b.name).toBe("B");
    expect(b.active).toBe(true);
    // A room in B, made by the owner, cannot be renamed by the limited person.
    const room = await addRoom(actorOf(owner), facB, { area: ROOM_AREAS[0].value, name: `RoomB-${run}` });
    await expect(updateRoom(actor, room.id, { area: ROOM_AREAS[0].value, name: "Renamed" })).rejects.toThrow(/not found/);
    const [after] = await db.select().from(locations).where(and(eq(locations.id, room.id)));
    expect(after.name).toBe(`RoomB-${run}`);
    // Their own facility works, and so does an unrestricted actor on any facility.
    await updateFacility(actor, facA, { name: "A renamed", licenseNumber: `AZ-A-${run}`, licenseType: "RETAIL", state: "NM" });
    await updateFacility(actorOf(owner), facB, { name: "B", licenseNumber: `AZ-B-${run}`, licenseType: "RETAIL", state: "NM" });
    // Whole-business changes need no facility limit.
    await expect(renameBusiness(actor, "Mine now")).rejects.toThrow(/every facility/);
    await expect(addFacility(actor, { name: "C", licenseNumber: `AZ-C-${run}`, licenseType: "RETAIL", state: "NM" })).rejects.toThrow(/every facility/);
  });
});
