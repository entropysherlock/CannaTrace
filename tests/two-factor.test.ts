import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { ROLE_LABELS, permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { createBusiness } from "@/lib/setup";
import { beginSetup, checkSecondStep, confirmSetup, turnOff, twoFactorStatus } from "@/lib/two-factor";
import { openSecret } from "@/lib/ai/secret-box";
import { totp } from "@/lib/totp";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = Date.now().toString(36);
const PASSWORD = "a-long-test-password";
const asSession = (s: { userId: string; orgId: string; facilityId: string; name: string }, role: Role = "OWNER"): Session => ({ ...s, role, customRoleId: null, permissions: permissionsFor(role), roleName: ROLE_LABELS[role] });
const load = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

describe.skipIf(!hasDb)("two-step sign-in", () => {
  let me: Session;
  const now = Date.now();
  beforeAll(async () => {
    process.env.AI_KEY_ENCRYPTION_KEY ||= "test-encryption-key-for-two-factor-0123456789";
    me = asSession(await createBusiness({ businessName: `TF ${run}`, facilityName: "Main", licenseNumber: `TF-${run}`, licenseType: "RETAIL", state: "NM", ownerName: "TF Owner", email: `tf-${run}@tf.test`, password: PASSWORD }, { onlyIfEmpty: false }));
  });
  afterAll(() => pool.end());

  it("is off until the first code is confirmed", async () => {
    expect((await twoFactorStatus(me)).enabled).toBe(false);
    const { key, otpauth } = await beginSetup(me);
    expect(key.length).toBeGreaterThan(20);
    expect(otpauth).toContain("otpauth://totp/");
    expect((await twoFactorStatus(me)).enabled).toBe(false);
    const user = await load(me.userId);
    expect(user.totpSecret).not.toContain(key.replace(/\s/g, ""));
    await expect(confirmSetup(me, "000000", now)).rejects.toThrow();
    const secret = openSecret(user.totpSecret!, user.orgId);
    const { recoveryCodes } = await confirmSetup(me, totp(secret, now), now);
    expect(recoveryCodes).toHaveLength(10);
    expect(await twoFactorStatus(me)).toMatchObject({ enabled: true, recoveryLeft: 10 });
  });

  it("takes each app code once, and each recovery code once", async () => {
    const user = await load(me.userId);
    const secret = openSecret(user.totpSecret!, user.orgId);
    const later = now + 90_000;
    const code = totp(secret, later);
    expect(await checkSecondStep(user, code, later)).toBe(true);
    expect(await checkSecondStep(await load(me.userId), code, later)).toBe(false);
    expect(await checkSecondStep(await load(me.userId), "123456", later)).toBe(false);
  });

  it("uses a recovery code once", async () => {
    const fresh = Date.now() + 10 * 60_000;
    const { hashRecoveryCode } = await import("@/lib/totp");
    await db.update(users).set({ recoveryCodeHashes: [hashRecoveryCode("abcde-fghjk")] }).where(eq(users.id, me.userId));
    expect(await checkSecondStep(await load(me.userId), "ABCDE FGHJK", fresh)).toBe(true);
    expect((await twoFactorStatus(me)).recoveryLeft).toBe(0);
    expect(await checkSecondStep(await load(me.userId), "abcde-fghjk", fresh)).toBe(false);
  });

  it("refuses turning off without the right password", async () => {
    await expect(turnOff(me, { password: "wrong-password-here", code: "123456" })).rejects.toThrow();
    expect((await twoFactorStatus(me)).enabled).toBe(true);
  });

  it("is blocked for support visits and the demo", async () => {
    await expect(beginSetup({ ...me, support: { by: "x" } } as unknown as Session)).rejects.toThrow();
    await expect(beginSetup({ ...me, isDemo: true } as Session)).rejects.toThrow();
  });
});
