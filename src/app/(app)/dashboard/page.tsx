import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auditLogs, facilities, locations as locationsTable, packages, syncEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await requireSession();
  const packageScope = and(eq(packages.orgId, session.orgId), eq(packages.facilityId, session.facilityId));
  const [[facility], active, held, locations, recent, needsAttention] = await Promise.all([
    db.select().from(facilities).where(eq(facilities.id, session.facilityId)),
    db.$count(packages, and(packageScope, eq(packages.status, "ACTIVE"))),
    db.$count(packages, and(packageScope, inArray(packages.status, ["ON_HOLD", "QUARANTINE"]))),
    db.$count(
      locationsTable,
      and(eq(locationsTable.orgId, session.orgId), eq(locationsTable.facilityId, session.facilityId)),
    ),
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, session.orgId), eq(auditLogs.facilityId, session.facilityId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(8),
    db.$count(
      syncEvents,
      and(eq(syncEvents.orgId, session.orgId), eq(syncEvents.facilityId, session.facilityId), inArray(syncEvents.status, ["FAILED", "MANUAL"])),
    ),
  ]);

  const tiles = [
    { label: "Active packages", value: active, href: "/inventory" },
    { label: "On hold or quarantined", value: held, href: "/inventory?status=ON_HOLD" },
    { label: "Storage locations", value: locations, href: "/inventory" },
  ];

  return (
    <>
      <PageHeader title={`Hello, ${session.name.split(" ")[0]}`} subtitle={facility ? `${facility.name} · license ${facility.licenseNumber}` : undefined} />
      {needsAttention > 0 ? (
        <Link href="/compliance" className="mb-4 block rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 hover:border-amber-500">
          {needsAttention} state report{needsAttention === 1 ? " needs" : "s need"} attention. Open State reporting ›
        </Link>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-500">
            <p className="text-sm text-slate-600">{tile.label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{tile.value}</p>
          </Link>
        ))}
      </div>
      <div className="mt-5">
        <Card title="Recent activity">
          {recent.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing has happened at this facility yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium text-slate-900">{entry.userName}</span>{" "}
                    <span className="text-slate-600">
                      {entry.action.toLowerCase()} · {entry.entityType.toLowerCase()}
                    </span>
                  </span>
                  <time className="text-slate-500">{entry.createdAt.toLocaleString("en-US")}</time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
