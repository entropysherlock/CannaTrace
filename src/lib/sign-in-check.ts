import "server-only";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Whether a sign-in still counts for this person: their account is active, and it was issued after their
 * password was last changed or reset (a reset signs out every earlier sign-in, support visits included).
 * issuedAt is the token's "iat" in seconds; tokens without one are judged on the account alone.
 */
export async function signInStillValid(userId: string, issuedAt: number | undefined): Promise<boolean> {
  const [user] = await db.select({ active: users.active, passwordChangedAt: users.passwordChangedAt }).from(users).where(eq(users.id, userId));
  if (!user || !user.active) return false;
  return !(user.passwordChangedAt && issuedAt !== undefined && issuedAt * 1000 < user.passwordChangedAt.getTime());
}
