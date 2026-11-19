import { and, eq, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { allowedEmails, canSignIn, openAccess } from "./access";
import { db } from "./db";

type Reader = Pick<typeof db, "select">;

/**
 * Invite-only covers businesses, not just people: a business with an active member on the access list is
 * in, and so is everyone that business invites. So an owner on the list can bring on their budtenders and
 * managers by invite, while strangers, old accounts, and the demo business stay locked out, and only
 * listed people can start a new business.
 */
export async function businessIsListed(orgId: string, reader: Reader = db): Promise<boolean> {
  if (openAccess()) return true;
  const listed = allowedEmails();
  if (listed.length === 0) return false;
  const [hit] = await reader
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.active, true), sql`lower(${users.email}) in ${listed}`))
    .limit(1);
  return Boolean(hit);
}

/** Whether this person may sign in: on the list themselves, or a member of a listed business. */
export async function memberMaySignIn(email: string | null | undefined, orgId: string, reader: Reader = db): Promise<boolean> {
  return canSignIn(email) || (await businessIsListed(orgId, reader));
}
