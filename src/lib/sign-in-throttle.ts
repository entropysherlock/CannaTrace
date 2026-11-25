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
/** Wrong passwords for one email from one address. A stranger guessing at someone's email locks only their own address out (APEX-20). */
export const MAX_PER_EMAIL = 8;
/** Wrong passwords for one email from anywhere: stops a guesser who spreads the attempts over many addresses. */
export const MAX_PER_EMAIL_ANYWHERE = 40;
export const MAX_PER_ADDRESS = 40;

const key = (kind: "email" | "ip" | "pair", value: string) => createHash("sha256").update(`${kind}:${value.trim().toLowerCase()}`).digest("hex");

export const LOCKED_MESSAGE = `Too many wrong passwords. Wait ${WINDOW_MINUTES} minutes and try again, or use "Forgot your password?" below.`;

export async function signInLocked(email: string, address: string | null): Promise<boolean> {
  const since = sql`now() - make_interval(mins => ${WINDOW_MINUTES})`;
  const count = async (k: string) =>
    Number(
      (await db.select({ n: sql<number>`count(*)::int` }).from(signInFailures).where(and(eq(signInFailures.key, k), gt(signInFailures.createdAt, since))))[0]?.n ?? 0,
    );
  const byEmail = await count(key("email", email));
  // Without an address to tell people apart, the email's own count is all there is.
  if (!address) return byEmail >= MAX_PER_EMAIL;
  if (byEmail >= MAX_PER_EMAIL_ANYWHERE) return true;
  if ((await count(key("pair", `${email}|${address}`))) >= MAX_PER_EMAIL) return true;
  return (await count(key("ip", address))) >= MAX_PER_ADDRESS;
}

export async function recordSignInFailure(email: string, address: string | null): Promise<void> {
  const rows = [{ key: key("email", email) }, ...(address ? [{ key: key("ip", address) }, { key: key("pair", `${email}|${address}`) }] : [])];
  await db.insert(signInFailures).values(rows);
  // Housekeeping: old rows are no use to anyone.
  await db.delete(signInFailures).where(lt(signInFailures.createdAt, sql`now() - interval '1 day'`));
}

export async function clearSignInFailures(email: string, address: string | null = null): Promise<void> {
  const keys = [key("email", email), ...(address ? [key("pair", `${email}|${address}`)] : [])];
  await db.delete(signInFailures).where(inArray(signInFailures.key, keys));
}
