import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, organizations, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addSupportAdmin, endSupportVisit, isPlatformAdmin, openSupportVisit, qualifiesAsFounder, removeSupportAdmin, SUPPORT_VISIT_MS } from "@/lib/platform-admin";

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
});
