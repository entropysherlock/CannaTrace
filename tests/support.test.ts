import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, organizations, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { SignJWT } from "jose";
import { addSupportAdmin, endSupportVisit, isPlatformAdmin, openSupportVisit, qualifiesAsFounder, removeSupportAdmin, SUPPORT_VISIT_MS } from "@/lib/platform-admin";
import { sessionFromToken, type SessionToken } from "@/lib/session";

/** A signed sign-in cookie for a token, issued at iat (seconds). */
const cookieFor = (t: SessionToken, iat = Math.floor(Date.now() / 1000)) =>
  new SignJWT({ userId: t.userId, orgId: t.orgId, facilityId: t.facilityId, role: t.role, name: t.name, ...(t.support ? { support: t.support } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + 12 * 3600)
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `SUP${Date.now().toString(36)}`;

describe("support admin rules", () => {
  it("only counts founder emails on accounts made before the console existed", () => {
    expect(qualifiesAsFounder("CCWestfall85@gmail.com ", new Date("2026-10-01"))).toBe(true);
    expect(qualifiesAsFounder("ccwestfall85@gmail.com", new Date("2026-12-01"))).toBe(false); // signed up later: not trusted
    expect(qualifiesAsFounder("someone@else.com", new Date("2020-01-01"))).toBe(false);
  });
});

describe.skipIf(!hasDb)("support visits (database)", () => {
  let admin: { userId: string; orgId: string; facilityId: string; name: string };
  let customerOrg: string;
  let helperId: string;

  beforeAll(async () => {
    const [home, customer] = await db.insert(organizations).values([{ name: `CannaTrace HQ ${run}` }, { name: `Customer ${run}` }]).returning();
    const [hq, shop] = await db
      .insert(facilities)
      .values([
        { orgId: home.id, name: "HQ", licenseNumber: `${run}-HQ`, licenseType: "RETAIL", state: "NM" },
        { orgId: customer.id, name: "Shop", licenseNumber: `${run}-S`, licenseType: "RETAIL", state: "NM" },
      ])
      .returning();
    const [a, h] = await db
      .insert(users)
      .values([
        { orgId: home.id, name: "Carly Support", email: `carly-${run}@test.invalid`, passwordHash: "x", role: "OWNER" },
        { orgId: home.id, name: "New Helper", email: `helper-${run}@test.invalid`, passwordHash: "x", role: "MANAGER" },
      ])
      .returning();
    admin = { userId: a.id, orgId: home.id, facilityId: hq.id, name: a.name };
    customerOrg = customer.id;
    helperId = h.id;
    expect(shop.orgId).toBe(customer.id);
  });
  afterAll(() => pool.end());

  it("refuses anyone who is not support, and support admins can grant and remove access", async () => {
    expect(await isPlatformAdmin(admin.userId)).toBe(false);
    await expect(openSupportVisit(admin, customerOrg, "help")).rejects.toThrow(/Only CannaTrace support admins/);
    await db.execute(sql`insert into platform_admins (user_id, added_by_name) values (${admin.userId}, 'test')`);
    expect(await isPlatformAdmin(admin.userId)).toBe(true);

    await expect(addSupportAdmin(admin, "nobody@nowhere.invalid")).rejects.toThrow(/No active CannaTrace account/);
    expect(await addSupportAdmin(admin, `HELPER-${run}@test.invalid`)).toBe("New Helper");
    expect(await isPlatformAdmin(helperId)).toBe(true);
    await expect(removeSupportAdmin(admin, admin.userId)).rejects.toThrow(/your own/);
    await removeSupportAdmin(admin, helperId);
    expect(await isPlatformAdmin(helperId)).toBe(false);
  });

  it("needs a reason, opens the customer's first facility for two hours, and logs start and end in their trail", async () => {
    await expect(openSupportVisit(admin, customerOrg, "  ")).rejects.toThrow(/Say why/);
    const before = Date.now();
    const token = await openSupportVisit(admin, customerOrg, "Label printer help");
    expect(token).toMatchObject({ userId: admin.userId, orgId: customerOrg, support: { homeOrgId: admin.orgId, homeFacilityId: admin.facilityId } });
    expect(token.support!.until).toBeGreaterThanOrEqual(before + SUPPORT_VISIT_MS);
    const home = await endSupportVisit({ ...token, support: token.support! }, admin.name);
    expect(home).toMatchObject({ orgId: admin.orgId, facilityId: admin.facilityId, role: "OWNER" });
    expect(home.support).toBeUndefined();
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.orgId, customerOrg));
    expect(trail.map((t) => [t.action, t.userName, t.reason])).toEqual(
      expect.arrayContaining([
        ["SUPPORT_VISIT_START", "Carly Support (CannaTrace support)", "Label printer help"],
        ["SUPPORT_VISIT_END", "Carly Support (CannaTrace support)", null],
      ]),
    );
  });

  it("ends a visit when it runs out, when support access is taken away, or when the password changes", async () => {
    await db.execute(sql`insert into platform_admins (user_id, added_by_name) values (${admin.userId}, 'test') on conflict do nothing`);
    const token = await openSupportVisit(admin, customerOrg, "Checking a sync error");
    const live = await sessionFromToken(await cookieFor(token));
    // Inside the customer's business only, with an owner's permissions, under a name that says support
    expect(live).toMatchObject({ orgId: customerOrg, name: "Carly Support (CannaTrace support)", roleName: "CannaTrace support" });

    // Ran out
    expect(await sessionFromToken(await cookieFor({ ...token, support: { ...token.support!, until: Date.now() - 1000 } }))).toBeNull();
    // A visit claiming a different home business is refused
    expect(await sessionFromToken(await cookieFor({ ...token, support: { ...token.support!, homeOrgId: customerOrg } }))).toBeNull();
    // Support access removed: the visit stops on the next request
    await db.execute(sql`delete from platform_admins where user_id = ${admin.userId}`);
    expect(await sessionFromToken(await cookieFor(token))).toBeNull();
    await db.execute(sql`insert into platform_admins (user_id, added_by_name) values (${admin.userId}, 'test')`);
    expect(await sessionFromToken(await cookieFor(token))).not.toBeNull();

    // Password reset after the visit started: the visit no longer counts...
    const issued = Math.floor(Date.now() / 1000) - 120;
    const stolen = await cookieFor(token, issued);
    await db.update(users).set({ passwordChangedAt: new Date(Date.now() - 60_000) }).where(eq(users.id, admin.userId));
    expect(await sessionFromToken(stolen)).toBeNull();
    // ...and it can't be swapped for a fresh sign-in to the support person's own account by leaving it
    await expect(endSupportVisit({ ...token, issuedAt: issued, support: token.support! }, admin.name)).rejects.toThrow(/no longer counts/);
    // A visit opened after the change still works, and leaving it returns home
    expect(await endSupportVisit({ ...token, issuedAt: Math.floor(Date.now() / 1000), support: token.support! }, admin.name)).toMatchObject({ orgId: admin.orgId });
    await db.update(users).set({ passwordChangedAt: null }).where(eq(users.id, admin.userId));
  });

  it("attributes what support changes to the support person, marked as support, in the customer's trail", async () => {
    const token = await openSupportVisit(admin, customerOrg, "Fixing a count");
    const visit = (await sessionFromToken(await cookieFor(token)))!;
    expect(visit.supportVisit).toMatchObject({ until: token.support!.until });
    // Every change goes through the actor built from the session: its user id is the support person's own
    expect({ userId: visit.userId, userName: visit.name, orgId: visit.orgId }).toEqual({
      userId: admin.userId,
      userName: "Carly Support (CannaTrace support)",
      orgId: customerOrg,
    });
  });
});
