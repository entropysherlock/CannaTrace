import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { customRoles, organizations, users } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";
import { ROLE_LABELS, can, cleanPermissions, permissionsFor, type Permission, type Role } from "./rbac";

export const SESSION_COOKIE = "ct_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

/** What goes in the sign-in cookie. Permissions are never stored there; they are looked up on every request. */
export type SessionToken = {
  userId: string;
  orgId: string;
  facilityId: string;
  role: Role;
  name: string;
};

export type Session = SessionToken & {
  /** Everything this person may do: their custom role's list if they have one, else their built-in role's. */
  permissions: Permission[];
  /** The role name to show, custom or built-in. */
  roleName: string;
  customRoleId: string | null;
  /** Signed in to the public live demo's sample business. */
  isDemo?: boolean;
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in your environment (see .env.example).");
  }
  return new TextEncoder().encode(value);
}

export async function createSession(session: SessionToken): Promise<void> {
  const { userId, orgId, facilityId, role, name } = session;
  const token = await new SignJWT({ userId, orgId, facilityId, role, name })
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

export async function readToken(token: string | undefined): Promise<SessionToken | null> {
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

export async function getSession(): Promise<SessionToken | null> {
  return readToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** The signed-in, still-active person with their current permissions, or null. Never redirects. */
export async function currentSession(): Promise<Session | null> {
  const session = await getSession();
  return session ? resolve(session) : null;
}

/** Session for a signed-in, still-active user. Role is re-read so demotions apply immediately. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  const full = await resolve(session);
  // The cookie is genuine but its account is gone or switched off: clear it, or sign-in and the
  // dashboard would keep sending the visitor to each other.
  if (!full) redirect("/signout");
  return full;
}

async function resolve(session: SessionToken): Promise<Session | null> {
  const [user] = await db
    .select({ role: users.role, name: users.name, customRoleId: users.customRoleId, customName: customRoles.name, customPermissions: customRoles.permissions, isDemo: organizations.isDemo })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .leftJoin(customRoles, and(eq(customRoles.id, users.customRoleId), eq(customRoles.orgId, users.orgId)))
    .where(and(eq(users.id, session.userId), eq(users.orgId, session.orgId), eq(users.active, true)));
  if (!user) return null;
  const custom = user.customRoleId && user.customPermissions;
  return {
    ...session,
    role: user.role,
    name: user.name,
    customRoleId: custom ? user.customRoleId : null,
    permissions: custom ? cleanPermissions(user.customPermissions ?? []) : permissionsFor(user.role),
    roleName: custom ? String(user.customName) : ROLE_LABELS[user.role],
    isDemo: user.isDemo,
  };
}

export class PermissionError extends Error {}

/** Things a visitor to the shared live demo may look at but not change: the team, the business, and outside connections. */
const LOCKED_IN_DEMO: readonly Permission[] = ["users.manage", "settings.manage", "integrations.manage"];
export const DEMO_LOCKED_MESSAGE =
  "That is switched off in the live demo, because everyone shares this sample business. Create your own account to use it.";

export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (session.isDemo && LOCKED_IN_DEMO.includes(permission)) throw new InventoryError(DEMO_LOCKED_MESSAGE);
  if (!can(session, permission)) {
    throw new PermissionError("Your role does not allow this action. Ask an owner or manager for access.");
  }
  return session;
}

/** For pages: send people without access back to the dashboard instead of showing an error. */
export async function requirePagePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (!can(session, permission)) redirect("/dashboard");
  return session;
}
