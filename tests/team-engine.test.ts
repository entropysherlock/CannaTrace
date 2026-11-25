import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invites, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { ROLE_LABELS, can, permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { createBusiness } from "@/lib/setup";
import {
  acceptInvite,
  changeUserRole,
  createInvite,
  deleteCustomRole,
  lookupInvite,
  revokeInvite,
  saveCustomRole,
  setUserActive,
} from "@/lib/team";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = Date.now().toString(36);
const mail = (who: string) => `${who}-${run}@team.test`;
const PASSWORD = "a-long-test-password";

const asSession = (s: { userId: string; orgId: string; facilityId: string; name: string }, role: Role = "OWNER"): Session => ({
  ...s,
  role,
  customRoleId: null,
  permissions: permissionsFor(role),
  roleName: ROLE_LABELS[role],
});

let owner: Session;
let other: Session;

describe.skipIf(!hasDb)("sign-up, invites, and custom roles", () => {
  beforeAll(async () => {
    const business = (who: string) => ({
      businessName: `Team Test ${who} ${run}`,
      facilityName: "Main",
      licenseNumber: `T-${who}-${run}`,
      licenseType: "RETAIL",
      state: "NM",
      ownerName: `${who} Owner`,
      email: mail(`${who}-owner`),
      password: PASSWORD,
    });
    owner = asSession(await createBusiness(business("a"), { onlyIfEmpty: false }));
    other = asSession(await createBusiness(business("b"), { onlyIfEmpty: false }));
  });
  afterAll(() => pool.end());

  it("lets a new business sign up even when others exist, but not with an email already in use", async () => {
    await expect(
      createBusiness(
        { businessName: "Dup", facilityName: "x", licenseNumber: `D-${run}`, licenseType: "RETAIL", state: "NM", ownerName: "x", email: mail("a-owner"), password: PASSWORD },
        { onlyIfEmpty: false },
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("invite links work once, for the right business and role", async () => {
    const { token } = await createInvite(owner, { email: mail("budtender"), roleChoice: "builtin:BUDTENDER" });
    const view = await lookupInvite(token);
    expect(view).toMatchObject({ status: "ok", roleName: "Budtender", email: mail("budtender") });
    expect(await lookupInvite(`${token}x`)).toEqual({ status: "missing" });

    await expect(acceptInvite(token, { name: "Bud", password: "short" })).rejects.toThrow(/at least 12/);
    const joined = await acceptInvite(token, { name: "Bud", password: PASSWORD });
    expect(joined).toMatchObject({ orgId: owner.orgId, facilityId: owner.facilityId, role: "BUDTENDER" });
    expect(await lookupInvite(token)).toEqual({ status: "used" });
    await expect(acceptInvite(token, { name: "Bud again", password: PASSWORD })).rejects.toThrow(/no longer works/);
  });

  it("a new invite replaces the old link, and cancelled or expired links stop working", async () => {
    const first = await createInvite(owner, { email: mail("twice"), roleChoice: "builtin:SALES" });
    const second = await createInvite(owner, { email: mail("twice"), roleChoice: "builtin:SALES" });
    expect(await lookupInvite(first.token)).toEqual({ status: "revoked" });
    const [row] = await db.select().from(invites).where(eq(invites.email, mail("twice"))).orderBy(invites.createdAt);
    expect(row).toBeTruthy();
    const open = (await db.select().from(invites).where(eq(invites.email, mail("twice")))).find((i) => !i.revokedAt)!;
    await revokeInvite(owner, open.id);
    expect(await lookupInvite(second.token)).toEqual({ status: "revoked" });

    const third = await createInvite(owner, { email: mail("late"), roleChoice: "builtin:SALES" });
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.email, mail("late")));
    expect(await lookupInvite(third.token)).toEqual({ status: "expired" });
    await expect(acceptInvite(third.token, { name: "Late", password: PASSWORD })).rejects.toThrow(/no longer works/);
  });

  it("will not invite someone who already has an account, or use another business's role", async () => {
    await expect(createInvite(owner, { email: mail("b-owner"), roleChoice: "builtin:SALES" })).rejects.toThrow(/already has/);
    const theirRole = await saveCustomRole(other, { name: "Their role", description: "", permissions: ["inventory.view"] });
    await expect(createInvite(owner, { email: mail("x"), roleChoice: `custom:${theirRole}` })).rejects.toThrow(/Choose a role/);
    await expect(revokeInvite(other, (await db.select().from(invites).where(eq(invites.orgId, owner.orgId)))[0].id)).rejects.toThrow();
  });

  it("custom roles decide exactly what someone can do", async () => {
    const roleId = await saveCustomRole(owner, {
      name: "Shift lead",
      description: "Register and counts",
      permissions: ["pos.use", "inventory.view", "inventory.write", "not.a.permission"],
    });
    const { token } = await createInvite(owner, { email: mail("lead"), roleChoice: `custom:${roleId}` });
    const lead = await acceptInvite(token, { name: "Lead", password: PASSWORD });
    const [row] = await db.select().from(users).where(eq(users.id, lead.userId));
    expect(row.customRoleId).toBe(roleId);

    const leadSession: Session = { ...lead, customRoleId: roleId, permissions: ["inventory.view", "inventory.write", "pos.use"], roleName: "Shift lead" };
    expect(can(leadSession, "pos.use")).toBe(true);
    expect(can(leadSession, "inventory.adjust")).toBe(false);

    await expect(saveCustomRole(owner, { name: "Manager", description: "", permissions: ["pos.use"] })).rejects.toThrow(/built-in role name/);
    await expect(saveCustomRole(owner, { name: "shift LEAD", description: "", permissions: ["pos.use"] })).rejects.toThrow(/already have/);
    await expect(saveCustomRole(owner, { name: "Empty", description: "", permissions: [] })).rejects.toThrow(/at least one/);
    await expect(deleteCustomRole(owner, roleId)).rejects.toThrow(/1 person has this role/);
  });

  it("only an owner can hand out owner powers", async () => {
    const { token } = await createInvite(owner, { email: mail("hr"), roleChoice: "builtin:READ_ONLY" });
    const hr = await acceptInvite(token, { name: "HR", password: PASSWORD });
    const teamRole = await saveCustomRole(owner, { name: "Team admin", description: "", permissions: ["users.manage", "inventory.view"] });
    await changeUserRole(owner, hr.userId, `custom:${teamRole}`);
    const admin: Session = { ...hr, role: "READ_ONLY", customRoleId: teamRole, permissions: ["inventory.view", "users.manage"], roleName: "Team admin" };

    // Can invite roles that do no more than their own (Apex II: no escalation), but not wider built-in roles...
    const viewer = await saveCustomRole(owner, { name: "Plain viewer", description: "", permissions: ["inventory.view"] });
    await createInvite(admin, { email: mail("ordinary"), roleChoice: `custom:${viewer}` });
    await expect(createInvite(admin, { email: mail("wider"), roleChoice: "builtin:BUDTENDER" })).rejects.toThrow(/no more than yours/);
    // ...but not owners, other team admins, or API control, and cannot touch owners or their own role.
    await expect(createInvite(admin, { email: mail("o2"), roleChoice: "builtin:OWNER" })).rejects.toThrow(/Only an owner/);
    await expect(createInvite(admin, { email: mail("o3"), roleChoice: `custom:${teamRole}` })).rejects.toThrow(/Only an owner/);
    await expect(saveCustomRole(admin, { name: "Sneaky", description: "", permissions: ["integrations.manage"] })).rejects.toThrow(/Only an owner/);
    await expect(saveCustomRole(admin, { id: teamRole, name: "Team admin", description: "", permissions: ["users.manage", "inventory.adjust"] })).rejects.toThrow(
      /Only an owner/,
    );
    await expect(changeUserRole(admin, owner.userId, "builtin:READ_ONLY")).rejects.toThrow(/Only an owner/);
    await expect(setUserActive(admin, owner.userId, false)).rejects.toThrow(/Only an owner/);
    await expect(changeUserRole(admin, admin.userId, "builtin:MANAGER")).rejects.toThrow(/your own/);

    // A plain manager cannot manage the team at all.
    await expect(createInvite(asSession(hr, "MANAGER"), { email: mail("m"), roleChoice: "builtin:SALES" })).rejects.toThrow(/does not allow/);
  });

  it("a business always keeps an active owner, and switched-off people are recorded", async () => {
    await expect(changeUserRole(owner, owner.userId, "builtin:MANAGER")).rejects.toThrow(/your own/);
    const { token } = await createInvite(owner, { email: mail("owner2"), roleChoice: "builtin:OWNER" });
    const owner2 = asSession(await acceptInvite(token, { name: "Second Owner", password: PASSWORD }));
    await changeUserRole(owner2, owner.userId, "builtin:MANAGER");
    await expect(changeUserRole(owner, owner2.userId, "builtin:MANAGER")).rejects.toThrow();
    await changeUserRole(owner2, owner.userId, "builtin:OWNER");
    await setUserActive(owner, owner2.userId, false);
    const [row] = await db.select().from(users).where(eq(users.id, owner2.userId));
    expect(row.active).toBe(false);
  });
});
