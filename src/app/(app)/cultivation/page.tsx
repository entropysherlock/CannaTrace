import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { CultivationTabs } from "@/components/cultivation-ui";
import { GrowGuide, type GrowData } from "@/components/grow-guide";
import { PageHeader } from "@/components/ui";
import { harvests, items, locations, plantBatches, plants, strains } from "@/db/schema";
import { harvestOnHand } from "@/lib/cultivation-math";
import { flowerRoom, plantsDueToFlower } from "@/lib/grow-drafts";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { itemCategoryNames } from "@/lib/quick-create-data";
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
    db.select({ id: items.id, name: items.name, unit: items.unit, strain: items.strain }).from(items).where(and(eq(items.orgId, session.orgId), eq(items.active, true), inArray(items.unit, ["MG", "G", "KG", "OZ", "LB"]))).orderBy(asc(items.name)).limit(2000),
  ]);

  // Plants that have been in veg as long as their strain says come up already checked, with the flower room ready.
  const scope = { orgId: session.orgId, facilityId: session.facilityId };
  const [dueRows, flowerRm] = await Promise.all([plantsDueToFlower(scope), flowerRoom(scope)]);
  const dueIds = new Set(dueRows.flatMap((d) => d.plantIds));
  const groups = new Map<string, GrowData["plantGroups"][number]>();
  for (const p of plantRows) {
    const key = `${p.batch}|${p.room}|${p.phase}`;
    const g = groups.get(key) ?? { key, label: `${p.batch} · ${p.strain} · ${p.room} · ${p.phase.toLowerCase()}`, phase: p.phase, ids: [], due: false };
    g.ids.push(p.id);
    groups.set(key, g);
  }
  const plantGroups = [...groups.values()].map((g) => {
    const due = g.phase === "VEGETATIVE" && g.ids.every((id) => dueIds.has(id));
    return { ...g, due, label: due ? `${g.label} · ready for flower` : g.label };
  });

  const dryingAll = harvestRows
    .filter((r) => r.h.status === "DRYING" && r.h.dryWeight === null)
    .map((r) => ({ id: r.h.id, day: Math.max(1, Number(r.age) + 1), label: `${r.h.name} · ${r.strain} · wet ${grams(r.h.wetWeight)}` }));
  // Most flower dries in about a week or more; before day 7 it is still waiting, not undone.
  const READY_DAY = 7;
  const dryingHarvests = dryingAll.map((d) => ({ id: d.id, label: `${d.label} · drying day ${d.day}`, day: d.day, ready: d.day >= READY_DAY }));
  const waitingToDry = dryingHarvests.filter((d) => !d.ready).length;
  const packable = harvestRows
    .map((r) => ({ id: r.h.id, label: `${r.h.name} · ${r.strain}`, left: harvestOnHand(r.h), strain: r.strain, roomId: r.h.locationId }))
    .filter((r) => r.left.gt(0))
    .map((r) => ({ id: r.id, label: r.label, left: grams(r.left.toString()), leftG: r.left.toString(), strain: r.strain, roomId: r.roomId }));
  const finishable = harvestRows.filter((r) => harvestOnHand(r.h).lte(0) || Number(r.h.packagedWeight) > 0).map((r) => ({ id: r.h.id, label: `${r.h.name} · ${r.strain}` }));

  const untagged = batchRows.reduce((n, b) => n + b.untagged, 0);
  const floweringCount = plantRows.filter((p) => p.phase === "FLOWERING").length;
  const counts = { untagged, plants: plantRows.length, flowering: floweringCount, toDry: dryingHarvests.filter((d) => d.ready).length, waiting: waitingToDry, toPackage: packable.length };

  const data: GrowData = {
    canAddRoom: can(session, "settings.manage"),
    canAddItem: can(session, "catalog.manage"),
    categories: can(session, "catalog.manage") ? await itemCategoryNames(session.orgId) : [],
    strains: strainRows,
    rooms,
    items: itemRows.map((i) => ({ id: i.id, label: `${i.name} (${unitLabel(i.unit)})`, strain: i.strain, unit: i.unit })),
    flowerRoomId: flowerRm?.id ?? null,
    untaggedBatches: batchRows,
    plantGroups,
    dryingHarvests,
    packableHarvests: packable,
    finishable,
    counts,
  };

  return (
    <>
      <PageHeader title="Grow" subtitle="From clone or seed to packaged harvest. Pick a step, fill in one short form, and it tells you what's next." />
      <CultivationTabs current="/cultivation" />
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
