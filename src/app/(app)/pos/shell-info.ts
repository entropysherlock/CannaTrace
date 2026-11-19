import "server-only";
import { eq } from "drizzle-orm";
import type { ShellInfo } from "@/components/register/shell";
import { facilities } from "@/db/schema";
import { db } from "@/lib/db";
import { myOpenDrawer } from "@/lib/pos";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { facilityZone } from "@/lib/time";

/** The register's top bar: store, open drawer, and who is signed in. */
export async function shellInfo(session: Session): Promise<ShellInfo & { drawerId: string | null }> {
  const [[facility], [drawer], zone] = await Promise.all([
    db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, session.facilityId)),
    myOpenDrawer(db, { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }).then((d) => [
      d ? { id: d.id, openedAt: d.openedAt, openedBy: d.openedByName } : undefined,
    ]),
    facilityZone(session.facilityId),
  ]);
  return {
    storeName: facility?.name ?? "Store",
    clerkName: session.name,
    canManage: can(session, "pos.manage"),
    timeZone: zone,
    drawerId: drawer?.id ?? null,
    drawerLine: drawer
      ? `Your drawer open since ${drawer.openedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })} by ${drawer.openedBy}`
      : "Drawer closed",
  };
}
