"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { facilities } from "@/db/schema";
import { db } from "@/lib/db";
import { field } from "@/lib/form";
import { createSession, requireSession } from "@/lib/session";

export async function switchFacility(formData: FormData): Promise<void> {
  const session = await requireSession();
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.id, field(formData, "facilityId")), eq(facilities.orgId, session.orgId)));
  if (facility) await createSession({ ...session, facilityId: facility.id });
  redirect("/dashboard");
}
