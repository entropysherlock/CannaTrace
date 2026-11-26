"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { field, type FormState } from "@/lib/form";
import { completeSignIn } from "@/lib/sign-in";
import { destroySession } from "@/lib/session";
import { startPending } from "@/lib/two-factor";
import { clearSignInFailures, LOCKED_MESSAGE, recordSignInFailure, signInLocked } from "@/lib/sign-in-throttle";

let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= bcrypt.hash("not-a-real-password", 12));

export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");
  if (!email || !password) return { error: "Enter your email and password." };

  const address = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  // Checked before the password, so a locked-out guesser learns nothing from right or wrong answers.
  if (await signInLocked(email, address)) return { error: LOCKED_MESSAGE };
  const [user] = await db.select().from(users).where(eq(users.email, email));
  // Always do one password check, so an unknown or switched-off email takes as long as a wrong password (APEX-20).
  const valid = await bcrypt.compare(password, user?.active ? user.passwordHash : await decoyHash()).then((ok) => Boolean(user?.active) && ok);
  if (!user || !valid) {
    await recordSignInFailure(email, address);
    return { error: "That email and password do not match an active account." };
  }
  // Two-step sign-in: the password was right, so ask for the code. Nothing is signed in yet. The failure count is
  // NOT cleared here, or someone who knows the password could reset it and keep guessing codes.
  if (user.totpEnabledAt) {
    await startPending(user.id);
    redirect("/login/verify");
  }
  await clearSignInFailures(email, address);
  const refused = await completeSignIn(user);
  if (refused) return refused;
  redirect("/dashboard");
}

/** Leaving the live demo goes back to the homepage rather than the sign-in screen. */
export async function leaveDemo(): Promise<void> {
  await destroySession();
  redirect("/");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}
