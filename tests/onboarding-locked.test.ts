import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { facilities, organizations, platformAdmins, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { createCustomerBusiness, listCustomerAccounts, setBusinessAccess } from "@/lib/platform-admin";
import { memberMaySignIn } from "@/lib/access-members";
import { permissionsFor } from "@/lib/rbac";
import { acceptInvite, createInvite } from "@/lib/team";

/**
 * The real first-customer path with the lock on, as in production: support sets up the business in the
 * Support Console, the owner opens their link, then the owner invites a budtender.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const run = `ONB${Date.now().toString(36)}`;
const saved = { ...process.env };
const locked = () => {
  delete process.env.OPEN_ACCESS;
  delete process.env.ALLOWED_SIGNIN_EMAILS;
  delete process.env.SIGNUPS_OPEN;
};
afterEach(() => {
  for (const k of ["OPEN_ACCESS", "ALLOWED_SIGNIN_EMAILS", "SIGNUPS_OPEN"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe.skipIf(!hasDb)("onboarding a customer while invite-only", () => {
  let admin: { userId: string; orgId: string; facilityId: string; name: string };
  beforeAll(async () => {
    const [home] = await db.insert(organizations).values({ name: `HQ ${run}` }).returning();
    const [hq] = await db.insert(facilities).values({ orgId: home.id, name: "HQ", licenseNumber: `${run}-HQ`, licenseType: "RETAIL", state: "NM" }).returning();
    const [a] = await db.insert(users).values({ orgId: home.id, name: "Support", email: `sup-${run}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    await db.insert(platformAdmins).values({ userId: a.id, addedByName: "test" });
    admin = { userId: a.id, orgId: home.id, facilityId: hq.id, name: a.name };
  });
  afterAll(() => pool.end());

  it("lets the new owner set up their account, and then their staff", async () => {
    locked();
    const biz = await createCustomerBusiness(admin, {
      businessName: `Mesa Greens ${run}`,
      facilityName: "Main St",
      licenseNumber: `${run}-1`,
      licenseType: "RETAIL",
      state: "NM",
      ownerEmail: `owner-${run}@shop.invalid`,
    });
    const owner = await acceptInvite(biz.inviteToken, { name: "Dana Owner", password: "a-long-test-password-1" });
    expect(owner.orgId).toBe(biz.orgId);

    const session = { ...owner, permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
    const staff = await createInvite(session, { email: `bud-${run}@shop.invalid`, roleChoice: "builtin:BUDTENDER" });
    const bud = await acceptInvite(staff.token, { name: "Sam Bud", password: "a-long-test-password-2" });
    expect(bud.orgId).toBe(biz.orgId);
    expect((await listCustomerAccounts()).find((a) => a.id === biz.orgId)?.access).toBe("approved");

    // Suspended (unpaid): nobody in it can sign in, and it needs a reason; restoring lets them back.
    await expect(setBusinessAccess(admin, biz.orgId, "suspend", " ")).rejects.toThrow(/Say why/);
    await setBusinessAccess(admin, biz.orgId, "suspend", "Unpaid since Dec 1");
    expect(await memberMaySignIn(`owner-${run}@shop.invalid`, biz.orgId)).toBe(false);
    expect(await memberMaySignIn(`bud-${run}@shop.invalid`, biz.orgId)).toBe(false);
    expect((await listCustomerAccounts()).find((a) => a.id === biz.orgId)?.access).toBe("suspended");
    const late = await createInvite(session, { email: `late-${run}@shop.invalid`, roleChoice: "builtin:SALES" });
    await expect(acceptInvite(late.token, { name: "Late", password: "a-long-test-password-3" })).rejects.toThrow(/invite-only/);

    await setBusinessAccess(admin, biz.orgId, "approve", "");
    expect(await memberMaySignIn(`owner-${run}@shop.invalid`, biz.orgId)).toBe(true);
    expect((await acceptInvite(late.token, { name: "Late", password: "a-long-test-password-3" })).orgId).toBe(biz.orgId);
  });

  it("still keeps out businesses nobody approved, and won't suspend your own", async () => {
    locked();
    const [org] = await db.insert(organizations).values({ name: `Stranger ${run}` }).returning();
    expect(await memberMaySignIn(`x-${run}@stranger.invalid`, org.id)).toBe(false);
    expect((await listCustomerAccounts()).find((a) => a.id === org.id)?.access).toBe("none");
    await expect(setBusinessAccess(admin, admin.orgId, "suspend", "oops")).rejects.toThrow(/your own business/);
  });
});
