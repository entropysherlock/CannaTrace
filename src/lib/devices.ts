import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { devicePairings, facilities, linkedDevices, users } from "@/db/schema";
import { memberMaySignIn } from "./access-members";
import { db } from "./db";
import { homeFacility } from "./facility-access";
import { InventoryError } from "./inventory-math";
import { can } from "./rbac";
import type { Session, SessionToken } from "./session";

/**
 * Linking a phone. A signed-in person asks for a one-time code (shown as a QR code), scans it with the phone, and
 * the phone is then "linked": it keeps a long random token in a cookie and can sign itself in again without a
 * password until someone revokes it. Only hashes of the code and the token are stored.
 */

export const DEVICE_COOKIE = "ct_device";
export const DEVICE_DAYS = 180;
const PAIRING_MINUTES = 10;
const MAX_PHONES_PER_PERSON = 5;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");

/** A friendly name for the phone from its browser's description. */
export function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  return "Phone or tablet";
}

/** A fresh one-time code for this person. Older unused codes of theirs stop working. */
export async function createPairing(session: Pick<Session, "userId" | "orgId" | "isDemo" | "support">): Promise<{ code: string; expiresAt: Date }> {
  if (session.isDemo) throw new InventoryError("The live demo can't link phones. Sign up for your own account to try it.");
  if (session.support) throw new InventoryError("Support visits can't link phones to a customer's account.");
  const code = token();
  const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
  await db.delete(devicePairings).where(and(eq(devicePairings.userId, session.userId), or(isNull(devicePairings.usedAt), lt(devicePairings.expiresAt, new Date()))));
  await db.insert(devicePairings).values({ orgId: session.orgId, userId: session.userId, codeHash: sha(code), expiresAt });
  return { code, expiresAt };
}

export type PairingCheck = { ok: true; name: string } | { ok: false; reason: "invalid" | "used" | "expired" };

/** Who a code would link a phone to, without using it up (the page asks before the person confirms). */
export async function checkPairing(code: string): Promise<PairingCheck> {
  const [row] = await db
    .select({ usedAt: devicePairings.usedAt, expiresAt: devicePairings.expiresAt, name: users.name })
    .from(devicePairings)
    .innerJoin(users, eq(users.id, devicePairings.userId))
    .where(eq(devicePairings.codeHash, sha(String(code))));
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return { ok: true, name: row.name };
}

/** Use the code up and link the phone. Returns the cookie value to keep on the phone, and who they are. */
export async function redeemPairing(code: string, userAgent: string | null): Promise<{ deviceToken: string; user: SessionToken } | null> {
  const used = await db
    .update(devicePairings)
    .set({ usedAt: new Date() })
    .where(and(eq(devicePairings.codeHash, sha(String(code))), isNull(devicePairings.usedAt), gt(devicePairings.expiresAt, new Date())))
    .returning({ userId: devicePairings.userId, orgId: devicePairings.orgId });
  if (!used[0]) return null;
  const who = await sessionFor(used[0].userId);
  if (!who) return null;
  const mine = await db.select({ id: linkedDevices.id }).from(linkedDevices).where(and(eq(linkedDevices.userId, who.userId), isNull(linkedDevices.revokedAt))).orderBy(asc(linkedDevices.createdAt));
  // The oldest phone steps aside when a sixth is linked.
  for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_PHONES_PER_PERSON - 1)))) {
    await db.update(linkedDevices).set({ revokedAt: new Date() }).where(eq(linkedDevices.id, old.id));
  }
  const deviceToken = token();
  const [device] = await db.insert(linkedDevices).values({ orgId: who.orgId, userId: who.userId, name: deviceName(userAgent), tokenHash: sha(deviceToken) }).returning({ id: linkedDevices.id });
  // The sign-in carries the phone's id, so unlinking the phone ends it straight away.
  return { deviceToken, user: { ...who, deviceId: device.id } };
}

/** The sign-in details for a person, or null when they may no longer sign in. */
async function sessionFor(userId: string): Promise<SessionToken | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.active) return null;
  if (!(await memberMaySignIn(user.email, user.orgId))) return null;
  const ordered = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.orgId, user.orgId)).orderBy(asc(facilities.createdAt));
  const facility = homeFacility(ordered, user, user.lastFacilityId);
  if (!facility) return null;
  return { userId: user.id, orgId: user.orgId, facilityId: facility.id, role: user.role, name: user.name };
}

/**
 * Who a linked phone's cookie belongs to, if it still counts: not revoked, the person still active, and linked
 * after their last password change (changing a password unlinks every phone).
 */
export async function deviceSession(deviceToken: string | undefined): Promise<{ user: SessionToken; deviceId: string } | null> {
  if (!deviceToken || deviceToken.length < 20) return null;
  const [device] = await db.select().from(linkedDevices).where(and(eq(linkedDevices.tokenHash, sha(deviceToken)), isNull(linkedDevices.revokedAt)));
  if (!device) return null;
  if (device.createdAt.getTime() < Date.now() - DEVICE_DAYS * 86_400_000) return null;
  const [owner] = await db.select({ passwordChangedAt: users.passwordChangedAt }).from(users).where(eq(users.id, device.userId));
  // A password change is stamped to the whole second, so compare to the second: a phone linked in that same second is not trusted.
  if (owner?.passwordChangedAt && Math.floor(owner.passwordChangedAt.getTime() / 1000) >= Math.floor(device.createdAt.getTime() / 1000)) return null;
  const user = await sessionFor(device.userId);
  if (!user) return null;
  // Remember when it was last used, but not on every request.
  if (!device.lastSeenAt || device.lastSeenAt.getTime() < Date.now() - 60_000) await db.update(linkedDevices).set({ lastSeenAt: new Date() }).where(eq(linkedDevices.id, device.id));
  return { user: { ...user, deviceId: device.id }, deviceId: device.id };
}

export type DeviceRow = { id: string; name: string; ownerName: string; createdAt: Date; lastSeenAt: Date | null; mine: boolean };

/** Phones linked to this person; a person who runs the team also sees everyone's. */
export async function listDevices(session: Session): Promise<DeviceRow[]> {
  const all = can(session, "users.manage");
  const rows = await db
    .select({ id: linkedDevices.id, name: linkedDevices.name, userId: linkedDevices.userId, ownerName: users.name, createdAt: linkedDevices.createdAt, lastSeenAt: linkedDevices.lastSeenAt })
    .from(linkedDevices)
    .innerJoin(users, eq(users.id, linkedDevices.userId))
    .where(and(eq(linkedDevices.orgId, session.orgId), isNull(linkedDevices.revokedAt), all ? undefined : eq(linkedDevices.userId, session.userId)))
    .orderBy(desc(linkedDevices.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, ownerName: r.ownerName, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, mine: r.userId === session.userId }));
}

/** Unlink a phone: it can't sign itself in again. Anyone may unlink their own; people who run the team may unlink any. */
export async function revokeDevice(session: Session, deviceId: string): Promise<void> {
  const [device] = await db.select().from(linkedDevices).where(and(eq(linkedDevices.id, String(deviceId)), eq(linkedDevices.orgId, session.orgId), isNull(linkedDevices.revokedAt)));
  if (!device || (device.userId !== session.userId && !can(session, "users.manage"))) throw new InventoryError("That phone isn't linked.");
  await db.update(linkedDevices).set({ revokedAt: new Date() }).where(eq(linkedDevices.id, device.id));
}
