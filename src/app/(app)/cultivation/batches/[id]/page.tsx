import { and, asc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CultivationTabs, WeightInput } from "@/components/cultivation-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { locations, plantBatches, plants, strains } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { destroyBatchAction, tagPlantsAction } from "../../actions";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("cultivation.view");
  const { id } = await params;
  const [batch] = await db
    .select({
      id: plantBatches.id,
      name: plantBatches.name,
      source: plantBatches.source,
      initialCount: plantBatches.initialCount,
      untaggedCount: plantBatches.untaggedCount,
      destroyedCount: plantBatches.destroyedCount,
      status: plantBatches.status,
      locationId: plantBatches.locationId,
      createdAt: plantBatches.createdAt,
      strainName: strains.name,
      roomName: locations.name,
    })
    .from(plantBatches)
    .innerJoin(strains, eq(strains.id, plantBatches.strainId))
    .innerJoin(locations, eq(locations.id, plantBatches.locationId))
    .where(and(eq(plantBatches.id, id), eq(plantBatches.orgId, session.orgId), eq(plantBatches.facilityId, session.facilityId)));
  if (!batch) notFound();

  const [rooms, statusCounts] = await Promise.all([
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
      .orderBy(asc(locations.name)),
    db
      .select({ status: plants.status, count: sql<number>`count(*)::int` })
      .from(plants)
      .where(eq(plants.batchId, batch.id))
      .groupBy(plants.status),
  ]);
  const tagged = statusCounts.reduce((sum, row) => sum + row.count, 0);
  const canWrite = can(session.role, "cultivation.write") && batch.untaggedCount > 0;
  const hidden = <input type="hidden" name="batchId" value={batch.id} />;

  return (
    <>
      <PageHeader
        title={batch.name}
        subtitle={`${batch.strainName} · started from ${batch.source.toLowerCase()}s on ${batch.createdAt.toLocaleDateString("en-US")}`}
        action={
          <Link href={`/cultivation/plants?batch=${batch.id}`} className="text-sm font-semibold text-emerald-700 hover:underline">
            See this batch&apos;s tagged plants
          </Link>
        }
      />
      <CultivationTabs current="/cultivation" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Where the plants are">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-600">Started with</dt>
            <dd className="text-right font-semibold">{batch.initialCount}</dd>
            <dt className="text-slate-600">Still untagged</dt>
            <dd className="text-right text-lg font-bold text-slate-900">{batch.untaggedCount}</dd>
            <dt className="text-slate-600">Tagged</dt>
            <dd className="text-right font-semibold">{tagged}</dd>
            <dt className="text-slate-600">Lost before tagging</dt>
            <dd className="text-right font-semibold">{batch.destroyedCount}</dd>
            <dt className="text-slate-600">Room</dt>
            <dd className="text-right">{batch.roomName}</dd>
          </dl>
        </Card>

        {canWrite ? (
          <>
            <Card title="Tag plants">
              <ActionForm action={tagPlantsAction} submitLabel="Tag plants">
                {hidden}
                <p className="text-sm text-slate-600">
                  Tagged plants become vegetative plants you track one by one. Enter the first tag on the roll and how many, or
                  scan a list.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Field label="First tag">
                      <input name="firstTag" autoCapitalize="characters" className={`${inputClass} font-mono`} />
                    </Field>
                  </div>
                  <Field label="How many">
                    <input name="count" inputMode="numeric" defaultValue={batch.untaggedCount} className={inputClass} />
                  </Field>
                </div>
                <Field label="Or scan each tag" hint="One per line. If you fill this in, the two boxes above are ignored.">
                  <textarea name="tagList" rows={3} autoCapitalize="characters" className={`${inputClass} py-2 font-mono`} />
                </Field>
                <Field label="Put them in">
                  <select name="locationId" defaultValue={batch.locationId} className={inputClass}>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
            </Card>
            <Card title="Record lost plants">
              <ActionForm action={destroyBatchAction} submitLabel="Record loss">
                {hidden}
                <Field label="How many untagged plants">
                  <input name="count" inputMode="numeric" required className={inputClass} />
                </Field>
                <Field label="Reason" hint="Required. Shown in the audit trail.">
                  <input name="reason" required className={inputClass} />
                </Field>
                <Field label="Waste weight (optional)">
                  <WeightInput name="waste" unitName="wasteUnit" />
                </Field>
              </ActionForm>
            </Card>
          </>
        ) : batch.untaggedCount === 0 ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 lg:col-span-2">
            Every plant in this batch has been tagged or accounted for. Nothing more to do here.
          </p>
        ) : null}
      </div>
    </>
  );
}
