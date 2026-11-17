"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { facilities, users } from "@/db/schema";
import { db } from "@/lib/db";
import { field, type FormState } from "@/lib/form";
import { createSession, destroySession } from "@/lib/session";

export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");
  if (!email || !password) return { error: "Enter your email and password." };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = user?.active ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) return { error: "That email and password do not match an active account." };

  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.orgId, user.orgId))
    .orderBy(asc(facilities.createdAt))
    .limit(1);
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
