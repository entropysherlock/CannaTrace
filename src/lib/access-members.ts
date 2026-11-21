import { and, eq, sql } from "drizzle-orm";
import { organizations, users } from "@/db/schema";
import { allowedEmails, canSignIn, openAccess } from "./access";
import { db } from "./db";

type Reader = Pick<typeof db, "select">;

/**
 * Invite-only covers businesses, not just people. A business is in when CannaTrace support approved it (setting
 * it up in the Support Console does this) or it has an active member on the server's access list; everyone it
 * invites is then in too. So a new customer's owner can bring on their budtenders and managers, while strangers,
 * old accounts and the demo business stay locked out, and only listed people can start a new business.
 * A business support has suspended is out, whatever else is true.
 */
export async function businessIsListed(orgId: string, reader: Reader = db): Promise<boolean> {
  if (openAccess()) return true;
  const [org] = await reader
    .select({ approved: organizations.accessApprovedAt, suspended: organizations.accessSuspendedAt })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org || org.suspended) return false;
  if (org.approved) return true;
  const listed = allowedEmails();
  if (listed.length === 0) return false;
  const [hit] = await reader
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.active, true), sql`lower(${users.email}) in ${listed}`))
    .limit(1);
  return Boolean(hit);
}

/**
 * Whether this person may sign in: a member of an approved or listed business. Someone on the server's list
 * may sign in too, unless their business is suspended.
 */
export async function memberMaySignIn(email: string | null | undefined, orgId: string, reader: Reader = db): Promise<boolean> {
  if (openAccess()) return true;
  if (canSignIn(email)) return !(await businessSuspended(orgId, reader));
  return businessIsListed(orgId, reader);
}

async function businessSuspended(orgId: string, reader: Reader): Promise<boolean> {
  const [org] = await reader.select({ suspended: organizations.accessSuspendedAt }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return Boolean(org?.suspended);
}
