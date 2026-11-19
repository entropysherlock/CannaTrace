"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { facilities, users } from "@/db/schema";
import { db } from "@/lib/db";
import { field, type FormState } from "@/lib/form";
import { INVITE_ONLY_MESSAGE } from "@/lib/access";
import { memberMaySignIn } from "@/lib/access-members";
import { homeFacility } from "@/lib/facility-access";
import { createSession, destroySession } from "@/lib/session";

export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");
  if (!email || !password) return { error: "Enter your email and password." };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = user?.active ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) return { error: "That email and password do not match an active account." };
  // Invite-only: listed people, and the staff of a listed business, may sign in.
  if (!(await memberMaySignIn(user.email, user.orgId))) return { error: INVITE_ONLY_MESSAGE };

  // Back to where they last worked, if they still may; otherwise the first facility they may use.
  const ordered = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.orgId, user.orgId)).orderBy(asc(facilities.createdAt));
  const facility = homeFacility(ordered, user, user.lastFacilityId);
  if (!facility) return { error: "Your organization has no facility yet. Ask the owner to add one." };

  await createSession({
    userId: user.id,
    orgId: user.orgId,
    facilityId: facility.id,
    role: user.role,
    name: user.name,
  });
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
