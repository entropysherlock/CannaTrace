import { and, desc, eq, ne, sql } from "drizzle-orm";
import { HomeScreen, type HomeView } from "@/components/register/home-screen";
import { RegisterShell } from "@/components/register/shell";
import { drawerSessions, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { waitingCount } from "@/lib/online-menu";
import { getRetailSettings, storePack } from "@/lib/pos";
import { can } from "@/lib/rbac";
import { minimumAge } from "@/lib/rules";
import { requirePagePermission } from "@/lib/session";
import { shellInfo } from "./shell-info";
import { facilityToday, facilityZone } from "@/lib/time";


export default async function RegisterPage() {
  const session = await requirePagePermission("pos.use");
  const [today, zone] = await Promise.all([facilityToday(session.facilityId), facilityZone(session.facilityId)]);
  // Times in the store's own time zone (the server runs in UTC).
  const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  const [info, settings, pack] = await Promise.all([shellInfo(session), getRetailSettings(db, session.facilityId), storePack(db, session.facilityId)]);
  const rows = info.drawerId
    ? await db
        .select({
          id: sales.id,
          number: sales.number,
          status: sales.status,
          total: sales.total,
          userName: sales.userName,
          createdAt: sales.createdAt,
          completedAt: sales.completedAt,
          // Fully qualified: inside the subquery an unqualified "id" would mean sale_lines.id, so the count was always 0.
          lineCount: sql<number>`(select count(*)::int from sale_lines sl where sl.sale_id = "sales"."id")`,
        })
        .from(sales)
        .where(and(eq(sales.drawerSessionId, info.drawerId), eq(sales.orgId, session.orgId)))
        .orderBy(desc(sales.createdAt))
        .limit(60)
    : [];
  // Carts held on other people's open drawers at this store: anyone may pick one up (it moves to their own drawer),
  // so a customer who comes back isn't stuck waiting for the budtender who started it.
  const others = info.drawerId
    ? await db
        .select({
          id: sales.id,
          number: sales.number,
          userName: sales.userName,
          createdAt: sales.createdAt,
          lineCount: sql<number>`(select count(*)::int from sale_lines sl where sl.sale_id = "sales"."id")`,
        })
        .from(sales)
        .innerJoin(drawerSessions, eq(drawerSessions.id, sales.drawerSessionId))
        .where(
          and(
            eq(sales.orgId, session.orgId),
            eq(sales.facilityId, session.facilityId),
            eq(sales.status, "OPEN"),
            eq(drawerSessions.status, "OPEN"),
            ne(sales.drawerSessionId, info.drawerId),
          ),
        )
        .orderBy(desc(sales.createdAt))
        .limit(20)
    : [];
  const done = rows.filter((s) => s.status === "COMPLETED");
  const view: HomeView = {
    today: today,
    rulesSaved: settings.saved,
    pickups: await waitingCount(session.facilityId),
    canManage: can(session, "pos.manage"),
    drawerOpen: Boolean(info.drawerId),
    ages: { adultMinAge: minimumAge(settings.adultMinAge, pack, "ADULT_USE"), medicalMinAge: minimumAge(settings.medicalMinAge, pack, "MEDICAL") },
    dailyLimits: settings.dailyLimits,
    heldCarts: rows
      // A cart with nothing in it isn't worth resuming: leave it off the list.
      .filter((s) => s.status === "OPEN" && s.lineCount > 0)
      .map((s) => ({ id: s.id, number: s.number, items: s.lineCount, clerk: s.userName.split(" ")[0], since: time(s.createdAt), other: false }))
      .concat(
        others
          .filter((s) => s.lineCount > 0)
          .map((s) => ({ id: s.id, number: s.number, items: s.lineCount, clerk: s.userName.split(" ")[0], since: time(s.createdAt), other: true })),
      ),
    shift: info.drawerId ? { sales: done.length, total: done.reduce((sum, s) => sum + Number(s.total ?? 0), 0).toFixed(2) } : null,
    recent: rows
      .filter((s) => s.status !== "OPEN")
      .slice(0, 8)
      .map((s) => ({ id: s.id, number: s.number, status: s.status, total: s.total, time: time(s.completedAt ?? s.createdAt) })),
  };
  return (
    <RegisterShell info={info}>
      <HomeScreen view={view} />
    </RegisterShell>
  );
}
