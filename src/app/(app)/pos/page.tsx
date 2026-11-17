import { and, desc, eq, sql } from "drizzle-orm";
import { HomeScreen, type HomeView } from "@/components/register/home-screen";
import { RegisterShell } from "@/components/register/shell";
import { saleLines, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { todayIn } from "@/lib/distribution-math";
import { getRetailSettings, storePack } from "@/lib/pos";
import { can } from "@/lib/rbac";
import { minimumAge } from "@/lib/rules";
import { requirePagePermission } from "@/lib/session";
import { shellInfo } from "./shell-info";

const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default async function RegisterPage() {
  const session = await requirePagePermission("pos.use");
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
          lineCount: sql<number>`(select count(*)::int from ${saleLines} where ${saleLines.saleId} = ${sales.id})`,
        })
        .from(sales)
        .where(and(eq(sales.drawerSessionId, info.drawerId), eq(sales.orgId, session.orgId)))
        .orderBy(desc(sales.createdAt))
        .limit(60)
    : [];
  const done = rows.filter((s) => s.status === "COMPLETED");
  const view: HomeView = {
    today: todayIn(),
    rulesSaved: settings.saved,
    canManage: can(session, "pos.manage"),
    drawerOpen: Boolean(info.drawerId),
    ages: { adultMinAge: minimumAge(settings.adultMinAge, pack, "ADULT_USE"), medicalMinAge: minimumAge(settings.medicalMinAge, pack, "MEDICAL") },
    heldCarts: rows
      .filter((s) => s.status === "OPEN")
      .map((s) => ({ id: s.id, number: s.number, items: s.lineCount, clerk: s.userName.split(" ")[0], since: time(s.createdAt) })),
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
