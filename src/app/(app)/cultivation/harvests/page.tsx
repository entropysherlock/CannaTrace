import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { CultivationTabs, daysSince, grams } from "@/components/cultivation-ui";
import { PageHeader, ScrollBox } from "@/components/ui";
import { harvests, locations, strains } from "@/db/schema";
import { db } from "@/lib/db";
import { harvestOnHand } from "@/lib/cultivation-math";
import { requirePagePermission } from "@/lib/session";

export default async function HarvestsPage() {
  const session = await requirePagePermission("cultivation.view");
  const rows = await db
    .select({ harvest: harvests, strainName: strains.name, roomName: locations.name })
    .from(harvests)
    .innerJoin(strains, eq(strains.id, harvests.strainId))
    .innerJoin(locations, eq(locations.id, harvests.locationId))
    .where(and(eq(harvests.orgId, session.orgId), eq(harvests.facilityId, session.facilityId)))
    .orderBy(asc(harvests.status), desc(harvests.harvestedAt))
    .limit(100);

  return (
    <>
      <PageHeader title="Harvests" subtitle="Dry it, weigh it, log the waste, package what is left." />
      <CultivationTabs current="/cultivation/harvests" />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No harvests yet. On the Plants tab, tick flowering plants and choose Harvest.
        </p>
      ) : (
        <ScrollBox label="Harvests" size="lg" className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {rows.map(({ harvest, strainName, roomName }) => (
            <li key={harvest.id}>
              <Link href={`/cultivation/harvests/${harvest.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-brand-50">
                <div>
                  <p className="font-semibold text-slate-900">{harvest.name}</p>
                  <p className="text-sm text-slate-600">
                    {strainName} · {harvest.plantCount} plant{harvest.plantCount === 1 ? "" : "s"} · {roomName}
                  </p>
                </div>
                <div className="text-right text-sm">
                  {harvest.status === "DRYING" ? (
                    <>
                      <p className="font-semibold text-amber-700">drying, day {daysSince(harvest.harvestedAt) + 1}</p>
                      <p className="text-slate-600">{grams(harvestOnHand(harvest).toString())} on hand</p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-slate-500">finished</p>
                      <p className="text-slate-600">{grams(harvest.packagedWeight)} packaged</p>
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        </ScrollBox>
      )}
    </>
  );
}
