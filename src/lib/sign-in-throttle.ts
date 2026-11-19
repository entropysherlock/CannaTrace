import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { signInFailures } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Slows down password guessing. After too many wrong passwords for one email (or from one network address)
 * within the window, sign-in is refused for that email or address until the window passes. A successful
 * sign-in clears that email's count. Keys are hashed; nothing here identifies a person in the clear.
 */
export const WINDOW_MINUTES = 15;
export const MAX_PER_EMAIL = 8;
export const MAX_PER_ADDRESS = 40;

const key = (kind: "email" | "ip", value: string) => createHash("sha256").update(`${kind}:${value.trim().toLowerCase()}`).digest("hex");

export const LOCKED_MESSAGE = `Too many wrong passwords. Wait ${WINDOW_MINUTES} minutes and try again, or use "Forgot password".`;

export async function signInLocked(email: string, address: string | null): Promise<boolean> {
  const since = sql`now() - make_interval(mins => ${WINDOW_MINUTES})`;
  const count = async (k: string) =>
    Number(
      (await db.select({ n: sql<number>`count(*)::int` }).from(signInFailures).where(and(eq(signInFailures.key, k), gt(signInFailures.createdAt, since))))[0]?.n ?? 0,
    );
  if ((await count(key("email", email))) >= MAX_PER_EMAIL) return true;
  return address ? (await count(key("ip", address))) >= MAX_PER_ADDRESS : false;
}

export async function recordSignInFailure(email: string, address: string | null): Promise<void> {
  const rows = [{ key: key("email", email) }, ...(address ? [{ key: key("ip", address) }] : [])];
  await db.insert(signInFailures).values(rows);
  // Housekeeping: old rows are no use to anyone.
  await db.delete(signInFailures).where(lt(signInFailures.createdAt, sql`now() - interval '1 day'`));
}

export async function clearSignInFailures(email: string): Promise<void> {
  await db.delete(signInFailures).where(inArray(signInFailures.key, [key("email", email)]));
}
