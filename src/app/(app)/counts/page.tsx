import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { cycleCounts, locations, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";

export default async function CountsPage() {
  const session = await requirePagePermission("inventory.adjust");
  const zone = await facilityZone(session.facilityId);
  const [rows, recent] = await Promise.all([
    db
      .select({
        id: locations.id,
        name: locations.name,
        packageCount: sql<number>`count(${packages.id})::int`,
      })
      .from(locations)
      .leftJoin(
        packages,
        and(eq(packages.locationId, locations.id), inArray(packages.status, ["ACTIVE", "ON_HOLD", "QUARANTINE", "ALLOCATED"])),
      )
      .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
      .groupBy(locations.id)
      .orderBy(asc(locations.name)),
    db
      .select({
        id: cycleCounts.id,
        userName: cycleCounts.userName,
        packagesCounted: cycleCounts.packagesCounted,
        variances: cycleCounts.variances,
        createdAt: cycleCounts.createdAt,
        locationName: locations.name,
      })
      .from(cycleCounts)
      .innerJoin(locations, eq(locations.id, cycleCounts.locationId))
      .where(and(eq(cycleCounts.orgId, session.orgId), eq(cycleCounts.facilityId, session.facilityId)))
      .orderBy(desc(cycleCounts.createdAt))
      .limit(20),
  ]);

  return (
    <>
      <PageHeader title="Cycle counts" subtitle="Pick a location, count what is there, and CannaTrace corrects the differences." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Count a location">
          <ul className="divide-y divide-slate-100 text-sm">
            {rows.map((row) => (
              <li key={row.id}>
                {row.packageCount > 0 ? (
                  <Link href={`/counts/${row.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:text-brand-700">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-slate-600">
                      {row.packageCount} package{row.packageCount === 1 ? "" : "s"} ›
                    </span>
                  </Link>
                ) : (
                  <div className="flex min-h-12 items-center justify-between gap-3 py-2 text-slate-400">
                    <span>{row.name}</span>
                    <span>empty</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Recent counts">
          {recent.length === 0 ? (
            <p className="text-sm text-slate-600">No counts yet at this facility.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((count) => (
                <li key={count.id} className="py-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-slate-900">{count.locationName}</span>
                    <time className="text-slate-500">{count.createdAt.toLocaleString("en-US", { timeZone: zone })}</time>
                  </div>
                  <p className="text-slate-600">
                    {count.userName} · {count.packagesCounted} counted ·{" "}
                    <span className={count.variances ? "font-semibold text-amber-700" : ""}>
                      {count.variances} corrected
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
