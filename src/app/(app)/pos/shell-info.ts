import "server-only";
import { and, eq } from "drizzle-orm";
import type { ShellInfo } from "@/components/register/shell";
import { drawerSessions, facilities } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/session";

/** The register's top bar: store, open drawer, and who is signed in. */
export async function shellInfo(session: Session): Promise<ShellInfo & { drawerId: string | null }> {
  const [[facility], [drawer]] = await Promise.all([
    db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, session.facilityId)),
    db
      .select({ id: drawerSessions.id, openedAt: drawerSessions.openedAt, openedBy: drawerSessions.openedByName })
      .from(drawerSessions)
      .where(and(eq(drawerSessions.orgId, session.orgId), eq(drawerSessions.facilityId, session.facilityId), eq(drawerSessions.status, "OPEN"))),
  ]);
  return {
    storeName: facility?.name ?? "Store",
    clerkName: session.name,
    canManage: can(session, "pos.manage"),
    drawerId: drawer?.id ?? null,
    drawerLine: drawer
      ? `Drawer open since ${drawer.openedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} by ${drawer.openedBy}`
      : "Drawer closed",
  };
}
