import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CultivationTabs, daysSince } from "@/components/cultivation-ui";
import { PlantBulkFields } from "@/components/plant-bulk-fields";
import { inputBase, PageHeader } from "@/components/ui";
import { locations, plantBatches, plants, strains } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { plantBulkAction } from "../actions";

const LIMIT = 500;

export default async function PlantsPage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string; room?: string; strain?: string; batch?: string }>;
}) {
  const session = await requirePagePermission("cultivation.view");
  const { phase = "", room = "", strain = "", batch = "" } = await searchParams;
  const scope = and(eq(plants.orgId, session.orgId), eq(plants.facilityId, session.facilityId));

  const [rows, rooms, strainRows] = await Promise.all([
    db
      .select({
        id: plants.id,
        tag: plants.tag,
        phase: plants.phase,
        phaseChangedAt: plants.phaseChangedAt,
        strainName: strains.name,
        roomName: locations.name,
        batchName: plantBatches.name,
      })
      .from(plants)
      .innerJoin(strains, eq(strains.id, plants.strainId))
      .innerJoin(locations, eq(locations.id, plants.locationId))
      .innerJoin(plantBatches, eq(plantBatches.id, plants.batchId))
      .where(
        and(
          scope,
          eq(plants.status, "ACTIVE"),
          phase === "VEGETATIVE" || phase === "FLOWERING" ? eq(plants.phase, phase) : undefined,
          room ? eq(plants.locationId, room) : undefined,
          strain ? eq(plants.strainId, strain) : undefined,
          batch ? eq(plants.batchId, batch) : undefined,
        ),
      )
      .orderBy(asc(plants.tag))
      .limit(LIMIT),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
      .orderBy(asc(locations.name)),
    db.select({ id: strains.id, name: strains.name }).from(strains).where(eq(strains.orgId, session.orgId)).orderBy(asc(strains.name)),
  ]);
  const canWrite = can(session, "cultivation.write");

  const list = (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {rows.map((plant) => (
        <li key={plant.id}>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-brand-50">
            {canWrite ? <input type="checkbox" name="plantId" value={plant.id} className="h-5 w-5 accent-brand-700" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm font-semibold text-slate-900">{plant.tag}</span>
              <span className="block truncate text-sm text-slate-600">
                {plant.strainName} · {plant.roomName} · {plant.batchName}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm">
              <span className={`block font-semibold ${plant.phase === "FLOWERING" ? "text-fuchsia-700" : "text-brand-700"}`}>
                {plant.phase.toLowerCase()}
              </span>
              <span className="block text-slate-500">day {daysSince(plant.phaseChangedAt) + 1}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader
        title="Plants"
        subtitle={`${rows.length}${rows.length === LIMIT ? "+" : ""} active tagged plant${rows.length === 1 ? "" : "s"} shown`}
      />
      <CultivationTabs current="/cultivation/plants" />
      <form className="mb-4 flex flex-wrap gap-2">
        {batch ? <input type="hidden" name="batch" value={batch} /> : null}
        <select name="phase" defaultValue={phase} aria-label="Phase" className={`${inputBase} w-auto`}>
          <option value="">Any phase</option>
          <option value="VEGETATIVE">Vegetative</option>
          <option value="FLOWERING">Flowering</option>
        </select>
        <select name="room" defaultValue={room} aria-label="Room" className={`${inputBase} w-auto`}>
          <option value="">Any room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select name="strain" defaultValue={strain} aria-label="Strain" className={`${inputBase} w-auto`}>
          <option value="">Any strain</option>
          {strainRows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="submit" className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
          Filter
        </button>
        {batch ? (
          <Link href="/cultivation/plants" className="flex min-h-11 items-center px-2 text-sm font-semibold text-brand-700 hover:underline">
            Show all batches
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No active plants match. Tag plants from a batch on the Overview tab to see them here.
        </p>
      ) : canWrite ? (
        <ActionForm action={plantBulkAction} submitLabel="Apply to ticked plants" className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">{list}</div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            <PlantBulkFields locations={rooms} />
          </div>
        </ActionForm>
      ) : (
        list
      )}
    </>
  );
}
