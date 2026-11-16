import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "./db";
import { can, type Permission, type Role } from "./rbac";

export const SESSION_COOKIE = "ct_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

export type Session = {
  userId: string;
  orgId: string;
  facilityId: string;
  role: Role;
  name: string;
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in your environment (see .env.example).");
  }
  return new TextEncoder().encode(value);
}

export async function createSession(session: Session): Promise<void> {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const { userId, orgId, facilityId, role, name } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || typeof orgId !== "string" || typeof facilityId !== "string") {
      return null;
    }
    return { userId, orgId, facilityId, role: role as Role, name: String(name ?? "") };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return readToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Session for a signed-in, still-active user. Role is re-read so demotions apply immediately. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  const [user] = await db
    .select({ role: users.role, name: users.name })
    .from(users)
    .where(and(eq(users.id, session.userId), eq(users.orgId, session.orgId), eq(users.active, true)));
  // The cookie is genuine but its account is gone or switched off: clear it, or sign-in and the
  // dashboard would keep sending the visitor to each other.
  if (!user) redirect("/signout");
  return { ...session, role: user.role, name: user.name };
}

export class PermissionError extends Error {}

export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (!can(session.role, permission)) {
    throw new PermissionError("Your role does not allow this action. Ask an owner or manager for access.");
  }
  return session;
}

/** For pages: send people without access back to the dashboard instead of showing an error. */
export async function requirePagePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (!can(session.role, permission)) redirect("/dashboard");
  return session;
}
