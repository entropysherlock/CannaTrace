import "server-only";
import { asc, eq } from "drizzle-orm";
import { facilities, users } from "@/db/schema";
import { db } from "./db";
import { INVITE_ONLY_MESSAGE } from "./access";
import { memberMaySignIn } from "./access-members";
import { homeFacility } from "./facility-access";
import { createSession } from "./session";

/**
 * Starts the signed-in session for someone who has passed every check (the password, and the second
 * step if they have one). Returns a message instead if they may not sign in after all.
 */
export async function completeSignIn(user: typeof users.$inferSelect): Promise<{ error: string } | null> {
  // Invite-only: listed people, and the staff of a listed business, may sign in.
  if (!(await memberMaySignIn(user.email, user.orgId))) return { error: INVITE_ONLY_MESSAGE };
  // Back to where they last worked, if they still may; otherwise the first facility they may use.
  const ordered = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.orgId, user.orgId)).orderBy(asc(facilities.createdAt));
  const facility = homeFacility(ordered, user, user.lastFacilityId);
  if (!facility) return { error: "Your organization has no facility yet. Ask the owner to add one." };
  await createSession({ userId: user.id, orgId: user.orgId, facilityId: facility.id, role: user.role, name: user.name });
  return null;
}
