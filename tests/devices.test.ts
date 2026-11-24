import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devicePairings, linkedDevices, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { checkPairing, createPairing, deviceName, deviceSession, listDevices, redeemPairing, revokeDevice } from "@/lib/devices";
import { ROLE_LABELS, permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { createBusiness } from "@/lib/setup";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = Date.now().toString(36);
const asSession = (s: { userId: string; orgId: string; facilityId: string; name: string }, role: Role = "OWNER"): Session => ({ ...s, role, customRoleId: null, permissions: permissionsFor(role), roleName: ROLE_LABELS[role] });

describe("naming a phone", () => {
  it("reads the browser's description", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("Android phone");
    expect(deviceName(null)).toBe("Phone or tablet");
  });
});

describe.skipIf(!hasDb)("linking a phone", () => {
  let owner: Session;
  let other: Session;
  beforeAll(async () => {
    const biz = (who: string) => ({ businessName: `Phone ${who} ${run}`, facilityName: "Main", licenseNumber: `PH-${who}-${run}`, licenseType: "RETAIL", state: "NM", ownerName: `${who} Owner`, email: `${who}-${run}@phone.test`, password: "a-long-test-password" });
    owner = asSession(await createBusiness(biz("a"), { onlyIfEmpty: false }));
    other = asSession(await createBusiness(biz("b"), { onlyIfEmpty: false }));
  });
  afterAll(() => pool.end());

  it("links a phone once, and the code is used up", async () => {
    const { code } = await createPairing(owner);
    expect(await checkPairing(code)).toEqual({ ok: true, name: owner.name });
    const linked = await redeemPairing(code, "iPhone");
    expect(linked?.user.userId).toBe(owner.userId);
    expect(linked?.deviceToken.length).toBeGreaterThan(30);
    expect(await redeemPairing(code, "iPhone")).toBeNull();
    expect(await checkPairing(code)).toEqual({ ok: false, reason: "used" });
    expect(await checkPairing("nonsense")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an expired code", async () => {
    const { code } = await createPairing(owner);
    await db.update(devicePairings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(devicePairings.userId, owner.userId));
    expect(await checkPairing(code)).toEqual({ ok: false, reason: "expired" });
    expect(await redeemPairing(code, "iPhone")).toBeNull();
  });

  it("a linked phone signs itself in until it is revoked", async () => {
    const { code } = await createPairing(owner);
    const linked = (await redeemPairing(code, "Mozilla/5.0 (Android 14; Mobile)"))!;
    const found = await deviceSession(linked.deviceToken);
    expect(found?.user.userId).toBe(owner.userId);
    expect(await deviceSession("not-a-real-token-not-a-real-token")).toBeNull();
    const mine = await listDevices(owner);
    const row = mine.find((d) => d.id === found!.deviceId)!;
    expect(row.name).toBe("Android phone");
    // Another business can't see or unlink it
    expect(await listDevices(other)).toEqual([]);
    await expect(revokeDevice(other, row.id)).rejects.toThrow(/isn't linked/);
    await revokeDevice(owner, row.id);
    expect(await deviceSession(linked.deviceToken)).toBeNull();
  });

  it("a sign-in made by a linked phone ends the moment that phone is unlinked", async () => {
    const linked = (await redeemPairing((await createPairing(owner)).code, "iPhone"))!;
    const { SignJWT } = await import("jose");
    const { sessionFromToken } = await import("@/lib/session");
    const iat = Math.floor(Date.now() / 1000);
    const { userId, orgId, facilityId, role, name } = linked.user;
    const cookie = await new SignJWT({ userId, orgId, facilityId, role, name, deviceId: linked.user.deviceId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    expect((await sessionFromToken(cookie))?.userId).toBe(owner.userId);
    await revokeDevice(owner, linked.user.deviceId!);
    expect(await sessionFromToken(cookie)).toBeNull();
  });

  it("stops working when the person is deactivated or changes their password", async () => {
    const a = (await redeemPairing((await createPairing(owner)).code, "iPhone"))!;
    await db.update(users).set({ passwordChangedAt: new Date(Date.now() + 5000) }).where(eq(users.id, owner.userId));
    expect(await deviceSession(a.deviceToken)).toBeNull();
    await db.update(users).set({ passwordChangedAt: null }).where(eq(users.id, owner.userId));
    expect(await deviceSession(a.deviceToken)).not.toBeNull();
    await db.update(users).set({ active: false }).where(eq(users.id, owner.userId));
    expect(await deviceSession(a.deviceToken)).toBeNull();
    await db.update(users).set({ active: true }).where(eq(users.id, owner.userId));
  });

  it("keeps at most five phones per person: the oldest steps aside", async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 6; i++) tokens.push((await redeemPairing((await createPairing(owner)).code, "iPhone"))!.deviceToken);
    const live = await db.select().from(linkedDevices).where(eq(linkedDevices.userId, owner.userId));
    expect(live.filter((d) => !d.revokedAt).length).toBeLessThanOrEqual(5);
    expect(await deviceSession(tokens[0])).toBeNull();
    expect(await deviceSession(tokens[5])).not.toBeNull();
  });

  it("the demo and support visits can't link phones", async () => {
    await expect(createPairing({ ...owner, isDemo: true })).rejects.toThrow(/demo/);
    await expect(createPairing({ ...owner, support: { homeOrgId: "x", homeFacilityId: "y", until: Date.now() + 1000 } })).rejects.toThrow(/Support/);
  });
});
