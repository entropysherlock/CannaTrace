"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { field, type FormState } from "@/lib/form";
import { completeSignIn } from "@/lib/sign-in";
import { clearSignInFailures, recordSignInFailure, signInLocked } from "@/lib/sign-in-throttle";
import { checkSecondStep, clearPending, LOCKED_CODE_MESSAGE, readPending, WRONG_CODE_MESSAGE } from "@/lib/two-factor";

/** The second step of sign-in: the code from the authenticator app, or a recovery code. */
export async function verifySecondStep(_state: FormState, formData: FormData): Promise<FormState> {
  const userId = await readPending();
  // The note is missing or ran out (5 minutes): start again from the password.
  if (!userId) redirect("/login");
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.active || !user.totpEnabledAt) {
    await clearPending();
    redirect("/login");
  }
  const address = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  // Wrong codes count against the same limit as wrong passwords, so a guesser cannot try a million codes.
  if (await signInLocked(user.email, address)) return { error: LOCKED_CODE_MESSAGE };
  if (!(await checkSecondStep(user, field(formData, "code")))) {
    await recordSignInFailure(user.email, address);
    return { error: WRONG_CODE_MESSAGE };
  }
  await clearSignInFailures(user.email, address);
  await clearPending();
  const refused = await completeSignIn(user);
  if (refused) return refused;
  redirect("/dashboard");
}

/** Gives up on the code step and goes back to the password screen. */
export async function cancelSecondStep(): Promise<void> {
  await clearPending();
  redirect("/login");
}
