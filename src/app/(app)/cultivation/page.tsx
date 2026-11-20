import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import { GrowGuide, type GrowData } from "@/components/grow-guide";
import { PageHeader } from "@/components/ui";
import { harvests, items, locations, plantBatches, plants, strains } from "@/db/schema";
import { harvestOnHand } from "@/lib/cultivation-math";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";

export const metadata = { title: "Grow" };

const grams = (n: string | number) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })} g`;

/** The whole grow on one screen: pick a step, fill in one short form, and Tally says what comes next. */
export default async function GrowPage() {
  const session = await requirePagePermission("cultivation.view");
  const here = (t: { orgId: unknown; facilityId: unknown }) => and(eq(t.orgId as never, session.orgId), eq(t.facilityId as never, session.facilityId));
  const canWrite = can(session, "cultivation.write");

  const [strainRows, rooms, batchRows, plantRows, harvestRows, itemRows] = await Promise.all([
    db.select({ id: strains.id, name: strains.name }).from(strains).where(and(eq(strains.orgId, session.orgId), eq(strains.active, true))).orderBy(asc(strains.name)),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(here(locations)).orderBy(asc(locations.name)),
    db
      .select({ id: plantBatches.id, name: plantBatches.name, untagged: plantBatches.untaggedCount, roomId: plantBatches.locationId, strain: strains.name })
      .from(plantBatches)
      .innerJoin(strains, eq(strains.id, plantBatches.strainId))
      .where(and(here(plantBatches), eq(plantBatches.status, "ACTIVE"), gt(plantBatches.untaggedCount, 0)))
      .orderBy(desc(plantBatches.createdAt))
      .limit(50),
    db
      .select({ id: plants.id, phase: plants.phase, strain: strains.name, room: locations.name, batch: plantBatches.name })
      .from(plants)
      .innerJoin(strains, eq(strains.id, plants.strainId))
      .innerJoin(locations, eq(locations.id, plants.locationId))
      .innerJoin(plantBatches, eq(plantBatches.id, plants.batchId))
      .where(and(here(plants), eq(plants.status, "ACTIVE")))
      .orderBy(asc(plantBatches.name))
      .limit(2000),
    db
      .select({ h: harvests, strain: strains.name, age: sql<number>`floor(extract(epoch from (now() - ${harvests.harvestedAt})) / 86400)::int` })
      .from(harvests)
      .innerJoin(strains, eq(strains.id, harvests.strainId))
      .where(and(here(harvests), ne(harvests.status, "FINISHED")))
      .orderBy(desc(harvests.harvestedAt))
      .limit(100),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(and(eq(items.orgId, session.orgId), eq(items.active, true))).orderBy(asc(items.name)).limit(2000),
  ]);

  const groups = new Map<string, GrowData["plantGroups"][number]>();
  for (const p of plantRows) {
    const key = `${p.batch}|${p.room}|${p.phase}`;
    const g = groups.get(key) ?? { key, label: `${p.batch} · ${p.strain} · ${p.room} · ${p.phase.toLowerCase()}`, phase: p.phase, ids: [] };
    g.ids.push(p.id);
    groups.set(key, g);
  }
  const plantGroups = [...groups.values()];

  const dryingAll = harvestRows
    .filter((r) => r.h.status === "DRYING" && r.h.dryWeight === null)
    .map((r) => ({ id: r.h.id, day: Math.max(1, Number(r.age) + 1), label: `${r.h.name} · ${r.strain} · wet ${grams(r.h.wetWeight)}` }));
  // Most flower dries in about a week or more; before day 7 it is still waiting, not undone.
  const READY_DAY = 7;
  const dryingHarvests = dryingAll.map((d) => ({ id: d.id, label: `${d.label} · drying day ${d.day}`, day: d.day, ready: d.day >= READY_DAY }));
  const waitingToDry = dryingHarvests.filter((d) => !d.ready).length;
  const packable = harvestRows
    .map((r) => ({ id: r.h.id, label: `${r.h.name} · ${r.strain}`, left: harvestOnHand(r.h) }))
    .filter((r) => r.left.gt(0))
    .map((r) => ({ id: r.id, label: r.label, left: grams(r.left.toString()) }));
  const finishable = harvestRows.filter((r) => harvestOnHand(r.h).lte(0) || Number(r.h.packagedWeight) > 0).map((r) => ({ id: r.h.id, label: `${r.h.name} · ${r.strain}` }));

  const untagged = batchRows.reduce((n, b) => n + b.untagged, 0);
  const floweringCount = plantRows.filter((p) => p.phase === "FLOWERING").length;
  const counts = { untagged, plants: plantRows.length, flowering: floweringCount, toDry: dryingHarvests.filter((d) => d.ready).length, waiting: waitingToDry, toPackage: packable.length };
  // Where the grow most likely is: the step with something waiting, working back from the end.
  const suggested = counts.toPackage ? 5 : counts.toDry ? 4 : counts.waiting && !counts.untagged && !counts.plants ? 4 : counts.untagged ? 1 : counts.plants ? 2 : 0;

  const data: GrowData = {
    canAddRoom: can(session, "settings.manage"),
    strains: strainRows,
    rooms,
    items: itemRows.map((i) => ({ id: i.id, label: `${i.name} (${unitLabel(i.unit)})` })),
    untaggedBatches: batchRows,
    plantGroups,
    dryingHarvests,
    packableHarvests: packable,
    finishable,
    counts,
    suggested,
  };

  return (
    <>
      <PageHeader title="Grow" subtitle="From clone or seed to packaged harvest. Pick a step, fill in one short form, and it tells you what's next." />
      {canWrite ? (
        <GrowGuide data={data} />
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
          You can look at the grow but not change it. See <a className="font-semibold underline" href="/cultivation/overview">everything on one page</a>.
        </p>
      )}
    </>
  );
}
