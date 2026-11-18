import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { auditLogs, facilities, invites, licenseTypeEnum, organizations, platformAdmins, users } from "@/db/schema";
import { db } from "./db";
import { signInStillValid } from "./sign-in-check";
import { InventoryError } from "./inventory-math";
import type { SessionToken } from "./session";
import { checkEmail } from "./setup";
import { isSupportedState } from "./states";
import { INVITE_DAYS, hashToken } from "./team";

/**
 * The first support admins, by email. An email here only counts for an account that already existed
 * when the support console was added, so nobody can sign up with one of these addresses later and
 * become an admin. Everyone else is added by an existing admin in the console.
 */
const FOUNDERS = ["calebwestfall1989@gmail.com", "ccwestfall85@gmail.com"];
const FOUNDERS_CUTOFF = new Date("2026-11-17T17:00:00Z");

/** How long one support visit lasts before the support person has to open the account again. */
export const SUPPORT_VISIT_MS = 2 * 60 * 60 * 1000;

export function nowMs(): number {
  return Date.now();
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ email: users.email, createdAt: users.createdAt, active: users.active, granted: platformAdmins.userId })
    .from(users)
    .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(eq(users.id, userId));
  if (!row || !row.active) return false;
  if (row.granted) return true;
  return qualifiesAsFounder(row.email, row.createdAt);
}

/** A founder email only counts for an account made before the console existed. */
export function qualifiesAsFounder(email: string, createdAt: Date): boolean {
  return FOUNDERS.includes(email.trim().toLowerCase()) && createdAt < FOUNDERS_CUTOFF;
}

// ---------- Support console ----------

export type CustomerAccount = {
  id: string;
  name: string;
  isDemo: boolean;
  createdAt: Date;
  facilities: { id: string; name: string; state: string; licenseType: string; licenseNumber: string }[];
  users: number;
  owners: string[];
  packages: number;
  lastActivity: Date | null;
};

/** Every business on CannaTrace, newest activity first. */
export async function listCustomerAccounts(): Promise<CustomerAccount[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    is_demo: boolean;
    created_at: string;
    users: number;
    owners: string[] | null;
    packages: number;
    last_activity: string | null;
  }>(sql`
    select o.id, o.name, o.is_demo, o.created_at,
      (select count(*)::int from users u where u.org_id = o.id and u.active) as users,
      (select array_agg(u.email order by u.created_at) from users u where u.org_id = o.id and u.role = 'OWNER' and u.active) as owners,
      (select count(*)::int from packages p where p.org_id = o.id) as packages,
      (select max(a.created_at) from audit_logs a where a.org_id = o.id) as last_activity
    from organizations o
    where not o.is_demo or o.demo_ready
    order by coalesce((select max(a.created_at) from audit_logs a where a.org_id = o.id), o.created_at) desc`);
  const facs = await db
    .select({ id: facilities.id, orgId: facilities.orgId, name: facilities.name, state: facilities.state, licenseType: facilities.licenseType, licenseNumber: facilities.licenseNumber })
    .from(facilities)
    .orderBy(asc(facilities.name));
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDemo: r.is_demo,
    createdAt: new Date(r.created_at),
    facilities: facs.filter((f) => f.orgId === r.id),
    users: r.users,
    owners: r.owners ?? [],
    packages: r.packages,
    lastActivity: r.last_activity ? new Date(r.last_activity) : null,
  }));
}

type Admin = { userId: string; orgId: string; facilityId: string; name: string };

/**
 * Start a support visit to a customer's account: a sign-in for their first facility that runs out
 * after two hours. The visit is written into the customer's own audit trail.
 */
export async function openSupportVisit(admin: Admin, orgId: string, reason: string, facilityId?: string): Promise<SessionToken> {
  if (!(await isPlatformAdmin(admin.userId))) throw new InventoryError("Only CannaTrace support admins can open customer accounts.");
  const why = reason.trim().slice(0, 300);
  if (!why) throw new InventoryError("Say why you are opening this account, for example \"Helping with a stuck label print\". It goes in their audit trail.");
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(facilityId ? and(eq(facilities.orgId, orgId), eq(facilities.id, facilityId)) : eq(facilities.orgId, orgId))
    .orderBy(asc(facilities.createdAt), asc(facilities.name))
    .limit(1);
  if (!facility) throw new InventoryError(facilityId ? "That facility is not part of this business." : "That business has no facilities yet, so there is nothing to open.");
  const until = nowMs() + SUPPORT_VISIT_MS;
  await db.insert(auditLogs).values({
    orgId,
    facilityId: facility.id,
    userId: admin.userId,
    userName: `${admin.name} (CannaTrace support)`,
    entityType: "Support",
    entityId: orgId,
    action: "SUPPORT_VISIT_START",
    reason: why,
    after: { until: new Date(until).toISOString() },
  });
  return {
    userId: admin.userId,
    orgId,
    facilityId: facility.id,
    role: "OWNER",
    name: admin.name,
    support: { homeOrgId: admin.orgId, homeFacilityId: admin.facilityId, until },
  };
}

/** End a support visit: log it in the customer's trail and return the support person to their own account. */
export async function endSupportVisit(session: SessionToken & { support: NonNullable<SessionToken["support"]> }, adminName: string): Promise<SessionToken> {
  // Leaving gives back a fresh sign-in to the support person's own account, so the visit's sign-in must
  // still count: a stolen or outdated visit cookie can't be turned into a new, longer sign-in.
  if (!(await signInStillValid(session.userId, session.issuedAt))) throw new InventoryError("That support visit no longer counts. Sign in again.");
  await db.insert(auditLogs).values({
    orgId: session.orgId,
    facilityId: session.facilityId,
    userId: session.userId,
    userName: `${adminName} (CannaTrace support)`,
    entityType: "Support",
    entityId: session.orgId,
    action: "SUPPORT_VISIT_END",
  });
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.userId));
  return { userId: session.userId, orgId: session.support.homeOrgId, facilityId: session.support.homeFacilityId, role: user?.role ?? "READ_ONLY", name: adminName };
}

export type SupportAdmin = { userId: string; name: string; email: string; addedBy: string | null; founder: boolean };

/** Who can use the support console. */
export async function listSupportAdmins(): Promise<SupportAdmin[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email, createdAt: users.createdAt, active: users.active, addedBy: platformAdmins.addedByName })
    .from(users)
    .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(sql`${platformAdmins.userId} is not null or lower(${users.email}) in ${FOUNDERS}`)
    .orderBy(asc(users.name));
  return rows
    .filter((r) => r.active && (r.addedBy !== null || r.createdAt < FOUNDERS_CUTOFF))
    .map((r) => ({ userId: r.userId, name: r.name, email: r.email, addedBy: r.addedBy, founder: r.addedBy === null }));
}

/** Give an existing CannaTrace account support access. */
export async function addSupportAdmin(admin: Admin, email: string): Promise<string> {
  if (!(await isPlatformAdmin(admin.userId))) throw new InventoryError("Only support admins can add support admins.");
  const [user] = await db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email.trim()})`);
  if (!user || !user.active) throw new InventoryError("No active CannaTrace account uses that email. They need an account first (sign up, or be invited to a team).");
  await db.insert(platformAdmins).values({ userId: user.id, addedByName: admin.name }).onConflictDoNothing();
  return user.name;
}

/** Take support access away. Founders listed in the code cannot be removed here. */
export async function removeSupportAdmin(admin: Admin, userId: string): Promise<void> {
  if (!(await isPlatformAdmin(admin.userId))) throw new InventoryError("Only support admins can remove support admins.");
  if (userId === admin.userId) throw new InventoryError("You cannot remove your own support access.");
  await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
}

export async function recentSupportVisits(limit = 20) {
  return db
    .select({ at: auditLogs.createdAt, who: auditLogs.userName, action: auditLogs.action, reason: auditLogs.reason, org: organizations.name })
    .from(auditLogs)
    .innerJoin(organizations, eq(organizations.id, auditLogs.orgId))
    .where(and(eq(auditLogs.entityType, "Support")))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

/**
 * Set up a business for a customer from the support console: the business, its first facility, and an
 * owner invite. The owner sets their own password from the invite link; support never sees it.
 */
export async function createCustomerBusiness(
  admin: Admin,
  input: { businessName: string; facilityName: string; licenseNumber: string; licenseType: string; state: string; ownerEmail: string },
): Promise<{ orgId: string; businessName: string; inviteToken: string; ownerEmail: string }> {
  if (!(await isPlatformAdmin(admin.userId))) throw new InventoryError("Only CannaTrace support admins can set up businesses.");
  const text = (value: string, message: string, max = 120) => {
    const t = value.trim().replace(/\s+/g, " ").slice(0, max);
    if (!t) throw new InventoryError(message);
    return t;
  };
  const businessName = text(input.businessName, "Enter the business name.", 100);
  const facilityName = text(input.facilityName, "Enter a name for the first facility, for example its street or nickname.", 100);
  const licenseNumber = text(input.licenseNumber, "Enter the facility's state license number.", 60).toUpperCase();
  if (!(licenseTypeEnum.enumValues as readonly string[]).includes(input.licenseType)) throw new InventoryError("Choose the license type.");
  const state = input.state.trim().toUpperCase();
  if (!isSupportedState(state)) throw new InventoryError("Choose one of the listed states.");
  const ownerEmail = checkEmail(input.ownerEmail);
  const token = randomBytes(32).toString("base64url");

  return db.transaction(async (tx) => {
    if ((await tx.$count(users, sql`lower(${users.email}) = ${ownerEmail}`)) > 0)
      throw new InventoryError("Someone already has a CannaTrace account with that email. Use a different email for the new owner.");
    const [org] = await tx.insert(organizations).values({ name: businessName }).returning({ id: organizations.id });
    const [facility] = await tx
      .insert(facilities)
      .values({ orgId: org.id, name: facilityName, licenseNumber, licenseType: input.licenseType as "RETAIL", state })
      .returning({ id: facilities.id });
    await tx.insert(invites).values({
      orgId: org.id,
      email: ownerEmail,
      role: "OWNER",
      tokenHash: hashToken(token),
      invitedBy: admin.userId,
      expiresAt: new Date(nowMs() + INVITE_DAYS * 86_400_000),
    });
    await tx.insert(auditLogs).values({
      orgId: org.id,
      facilityId: facility.id,
      userId: admin.userId,
      userName: `${admin.name} (CannaTrace support)`,
      entityType: "Business",
      entityId: org.id,
      action: "SUPPORT_CREATED_BUSINESS",
      after: { businessName, facilityName, licenseNumber, state, ownerEmail },
    });
    return { orgId: org.id, businessName, inviteToken: token, ownerEmail };
  });
}
