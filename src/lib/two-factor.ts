import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, users } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";
import { openSecret, sealSecret, SecretBoxError, encryptionReady } from "./ai/secret-box";
import type { Session } from "./session";
import { DEMO_LOCKED_MESSAGE } from "./session";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  generateSecret,
  groupSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from "./totp";

/**
 * Two-step sign-in. After the right password, a person with two-step switched on also types the 6-digit
 * code from their authenticator app (or one of their recovery codes). Until that second step passes there is
 * no sign-in cookie at all, only a short-lived "password was right" note that opens nothing by itself.
 */

export const ISSUER = "Leaf2Sale";
export const PENDING_COOKIE = "ct_2fa";
const PENDING_SECONDS = 5 * 60;

export const NOT_READY_MESSAGE = "Two-step sign-in can't be turned on yet: this server has no encryption key set up. Ask Leaf2Sale support.";
export const WRONG_CODE_MESSAGE = "That code isn't right. Check the code in your app and try again, or use a recovery code.";
export const LOCKED_CODE_MESSAGE = "Too many wrong codes. Wait 15 minutes and try again.";

function authSecret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) throw new Error("AUTH_SECRET is missing or too short. Set it in your environment (see .env.example).");
  return new TextEncoder().encode(value);
}

// ---------- The "password was right, now the code" note ----------

export async function startPending(userId: string): Promise<void> {
  const token = await new SignJWT({ userId, purpose: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_SECONDS}s`)
    .sign(authSecret());
  (await cookies()).set(PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/login",
    maxAge: PENDING_SECONDS,
  });
}

/** Who passed the password step a moment ago, or null if the note is missing, forged, or has expired. */
export async function readPending(): Promise<string | null> {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    return payload.purpose === "2fa" && typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}

export async function clearPending(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
}

// ---------- Checking a code at sign-in ----------

type Loaded = typeof users.$inferSelect;

/**
 * Checks what was typed against this person's two-step. A 6-digit code from the app, or a recovery code
 * (which is then used up). Each accepted app code is remembered, so the same code cannot be used twice.
 */
export async function checkSecondStep(user: Loaded, typed: string, nowMs = Date.now()): Promise<boolean> {
  if (!user.totpEnabledAt || !user.totpSecret) return false;
  const text = typed.trim();
  if (!text) return false;
  if (looksLikeRecoveryCode(text) && !/^\d{6}$/.test(text.replace(/\s/g, ""))) {
    const hash = hashRecoveryCode(text);
    // One statement both checks and removes the code, so two tries at once cannot both win.
    const used = await db
      .update(users)
      .set({ recoveryCodeHashes: sql`array_remove(${users.recoveryCodeHashes}, ${hash})` })
      .where(and(eq(users.id, user.id), sql`${hash} = any(${users.recoveryCodeHashes})`))
      .returning({ id: users.id });
    return used.length === 1;
  }
  let secret: string;
  try {
    secret = openSecret(user.totpSecret, user.orgId);
  } catch (error) {
    if (error instanceof SecretBoxError) return false;
    throw error;
  }
  const step = verifyTotp(secret, text, nowMs, user.totpLastStep);
  if (step === null) return false;
  const accepted = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, user.id), sql`(${users.totpLastStep} is null or ${users.totpLastStep} < ${step})`))
    .returning({ id: users.id });
  return accepted.length === 1;
}

// ---------- Setting it up, checking it, turning it off ----------

export type TwoFactorStatus = { enabled: boolean; since: Date | null; recoveryLeft: number; ready: boolean };

export async function twoFactorStatus(session: Pick<Session, "userId" | "orgId">): Promise<TwoFactorStatus> {
  const [user] = await db
    .select({ at: users.totpEnabledAt, hashes: users.recoveryCodeHashes })
    .from(users)
    .where(and(eq(users.id, session.userId), eq(users.orgId, session.orgId)));
  return { enabled: Boolean(user?.at), since: user?.at ?? null, recoveryLeft: user?.hashes?.length ?? 0, ready: encryptionReady() };
}

function needOwnAccount(session: Session) {
  if (session.support) throw new InventoryError("Support visits can't change a customer's sign-in.");
  // The live demo is one shared account; turning this on would lock every other visitor out.
  if (session.isDemo) throw new InventoryError(DEMO_LOCKED_MESSAGE);
}

async function loadOwn(session: Session): Promise<Loaded> {
  const [user] = await db.select().from(users).where(and(eq(users.id, session.userId), eq(users.orgId, session.orgId), eq(users.active, true)));
  if (!user) throw new InventoryError("Your account could not be found.");
  return user;
}

const audit = (session: Session, action: string, after: object = {}) =>
  db.insert(auditLogs).values({ orgId: session.orgId, userId: session.userId, userName: session.name, entityType: "User", entityId: session.userId, action, after });

/** Step 1: make a secret and keep it (encrypted) as "not switched on yet". Returns what the app needs. */
export async function beginSetup(session: Session): Promise<{ otpauth: string; key: string }> {
  needOwnAccount(session);
  if (!encryptionReady()) throw new InventoryError(NOT_READY_MESSAGE);
  const user = await loadOwn(session);
  if (user.totpEnabledAt) throw new InventoryError("Two-step sign-in is already on. Turn it off first to set it up again.");
  const secret = generateSecret();
  await db.update(users).set({ totpSecret: sealSecret(secret, user.orgId), totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: null }).where(eq(users.id, user.id));
  return { otpauth: otpauthUrl(user.email, ISSUER, secret), key: groupSecret(secret) };
}

/** Step 2: the person types the first code from their app. If it matches, two-step is on and the recovery codes are shown once. */
export async function confirmSetup(session: Session, typed: string, nowMs = Date.now()): Promise<{ recoveryCodes: string[] }> {
  needOwnAccount(session);
  const user = await loadOwn(session);
  if (user.totpEnabledAt) throw new InventoryError("Two-step sign-in is already on.");
  if (!user.totpSecret) throw new InventoryError("Start the setup again to get a new code.");
  const step = verifyTotp(openSecret(user.totpSecret, user.orgId), typed, nowMs, null);
  if (step === null) throw new InventoryError(WRONG_CODE_MESSAGE);
  const codes = generateRecoveryCodes();
  await db.update(users).set({ totpEnabledAt: new Date(nowMs), totpLastStep: step, recoveryCodeHashes: codes.map(hashRecoveryCode) }).where(eq(users.id, user.id));
  await audit(session, "TWO_FACTOR_ON");
  return { recoveryCodes: codes };
}

/** Turning it off or making new recovery codes needs the password and a current code, so a borrowed screen is not enough. */
async function proveItsThem(session: Session, password: string, typed: string): Promise<Loaded> {
  needOwnAccount(session);
  const user = await loadOwn(session);
  if (!user.totpEnabledAt) throw new InventoryError("Two-step sign-in is not on.");
  if (!(await bcrypt.compare(password, user.passwordHash))) throw new InventoryError("Your password isn't right.");
  if (!(await checkSecondStep(user, typed))) throw new InventoryError(WRONG_CODE_MESSAGE);
  return user;
}

export async function turnOff(session: Session, input: { password: string; code: string }): Promise<void> {
  const user = await proveItsThem(session, input.password, input.code);
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: null }).where(eq(users.id, user.id));
  await audit(session, "TWO_FACTOR_OFF");
}

export async function newRecoveryCodes(session: Session, input: { password: string; code: string }): Promise<{ recoveryCodes: string[] }> {
  const user = await proveItsThem(session, input.password, input.code);
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await db.update(users).set({ recoveryCodeHashes: codes.map(hashRecoveryCode) }).where(eq(users.id, user.id));
  await audit(session, "RECOVERY_CODES_NEW");
  return { recoveryCodes: codes };
}
