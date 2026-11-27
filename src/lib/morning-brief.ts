import "server-only";
import { and, eq } from "drizzle-orm";
import { customRoles, facilities, users } from "@/db/schema";
import { TOOLS } from "@/lib/assistant/tools";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { cleanPermissions, permissionsFor, ROLE_LABELS } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { facilityZone, inFacilityZone } from "@/lib/time";
import { renderBriefEmail, type Brief } from "@/lib/morning-brief-email";

const MAX_FACILITIES = 5;

/** Emails each person who turned the brief on. Idempotent per local day, so a retried run never sends twice. */
export async function sendMorningBriefs(): Promise<{ people: number; sent: number; skipped: number; failed: number; firstError?: string }> {
  const people = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      name: users.name,
      role: users.role,
      customRoleId: users.customRoleId,
      customPermissions: customRoles.permissions,
      facilityIds: users.facilityIds,
      sentOn: users.morningBriefSentOn,
    })
    .from(users)
    .leftJoin(customRoles, and(eq(customRoles.id, users.customRoleId), eq(customRoles.orgId, users.orgId)))
    .where(and(eq(users.active, true), eq(users.morningBrief, true)));
  const tool = TOOLS.find((t) => t.name === "start_of_day_brief");
  const out = { people: people.length, sent: 0, skipped: 0, failed: 0, firstError: undefined as string | undefined };
  if (!tool || tool.kind !== "read") throw new Error("The morning brief tool is missing.");
  for (const person of people) {
    try {
      const all = await db.select().from(facilities).where(and(eq(facilities.orgId, person.orgId), eq(facilities.active, true)));
      const mine = person.role === "OWNER" || !person.facilityIds ? all : all.filter((f) => person.facilityIds!.includes(f.id));
      const shown = mine.slice(0, MAX_FACILITIES);
      if (!shown.length) { out.skipped++; continue; }
      const zone = await facilityZone(shown[0].id);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
      if (person.sentOn === today) { out.skipped++; continue; }
      const custom = person.customRoleId && person.customPermissions;
      const sections: { facility: string; brief: Brief }[] = [];
      for (const f of shown) {
        const session: Session = {
          userId: person.id,
          orgId: person.orgId,
          facilityId: f.id,
          role: person.role,
          name: person.name,
          permissions: custom ? cleanPermissions(person.customPermissions ?? []) : permissionsFor(person.role),
          roleName: ROLE_LABELS[person.role],
          customRoleId: custom ? person.customRoleId : null,
          facilityIds: person.facilityIds,
        };
        sections.push({ facility: f.name, brief: (await inFacilityZone(f.id, () => tool.run(session, {}))) as Brief });
      }
      const label = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone });
      const mail = renderBriefEmail(person.name.split(" ")[0] || person.name, sections, label);
      const result = await sendEmail({ to: person.email, ...mail });
      if (!result.sent) { out.failed++; out.firstError ??= result.reason; continue; }
      await db.update(users).set({ morningBriefSentOn: today }).where(eq(users.id, person.id));
      out.sent++;
    } catch (error) {
      out.failed++;
      out.firstError ??= error instanceof Error ? error.message : "unknown error";
    }
  }
  return out;
}
