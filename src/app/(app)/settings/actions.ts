"use server";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLogs, facilities, users } from "@/db/schema";
import { db } from "@/lib/db";
import { field, toFormError, type FormState } from "@/lib/form";
import { ROLES, type Role } from "@/lib/rbac";
import { createSession, requirePermission, requireSession } from "@/lib/session";

export async function switchFacility(formData: FormData): Promise<void> {
  const session = await requireSession();
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, field(formData, "facilityId")), eq(facilities.orgId, session.orgId)));
  if (facility) await createSession({ ...session, facilityId: facility.id });
  redirect("/dashboard");
}

export async function addUser(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("users.manage");
    const name = field(formData, "name");
    const email = field(formData, "email").toLowerCase();
    const password = field(formData, "password");
    const role = field(formData, "role") as Role;
    if (!name || !email.includes("@")) return { error: "Enter a name and a valid email address." };
    if (password.length < 8) return { error: "Password must be at least 8 characters." };
    if (!ROLES.includes(role)) return { error: "Choose a role." };

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ orgId: session.orgId, name, email, role, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      if (!user) return null;
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        userName: session.name,
        entityType: "User",
        entityId: user.id,
        action: "CREATE",
        after: { name, email, role },
      });
      return user;
    });
    if (!created) return { error: "Someone already has an account with that email." };
    revalidatePath("/settings");
    return { ok: `${name} can now sign in.` };
  } catch (error) {
    return toFormError(error);
  }
}
