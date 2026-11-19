import { and, asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect } from "@/components/contextual-create";
import { CultivationTabs, StrainFields } from "@/components/cultivation-ui";
import { RoomFields } from "@/components/quick-fields";
import { Card, Field, PageHeader, inputClass, ScrollBox } from "@/components/ui";
import { cultivationTasks, harvests, locations, plantBatches, plants, strains } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { quickRoomAction } from "../quick-create-actions";
import { batchAction, completeTaskAction, quickStrainAction, taskAction } from "./actions";

export default async function CultivationPage() {
  const session = await requirePagePermission("cultivation.view");
  const canWrite = can(session, "cultivation.write");
  // Rooms are facility settings: only people who manage settings can add one from here.
  const canAddRoom = can(session, "settings.manage");
  const inFacility = <T extends { orgId: unknown; facilityId: unknown }>(t: T) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    and(eq(t.orgId as any, session.orgId), eq(t.facilityId as any, session.facilityId));

  const [phaseCounts, [immature], drying, batches, strainRows, rooms, tasks] = await Promise.all([
    db
      .select({ phase: plants.phase, count: sql<number>`count(*)::int` })
      .from(plants)
      .where(and(inFacility(plants), eq(plants.status, "ACTIVE")))
      .groupBy(plants.phase),
    db
      .select({ count: sql<number>`coalesce(sum(${plantBatches.untaggedCount}), 0)::int` })
      .from(plantBatches)
      .where(and(inFacility(plantBatches), eq(plantBatches.status, "ACTIVE"))),
    db.$count(harvests, and(inFacility(harvests), eq(harvests.status, "DRYING"))),
    db
      .select({
        id: plantBatches.id,
        name: plantBatches.name,
        source: plantBatches.source,
        untaggedCount: plantBatches.untaggedCount,
        initialCount: plantBatches.initialCount,
        status: plantBatches.status,
        strainName: strains.name,
        roomName: locations.name,
      })
      .from(plantBatches)
      .innerJoin(strains, eq(strains.id, plantBatches.strainId))
      .innerJoin(locations, eq(locations.id, plantBatches.locationId))
      .where(inFacility(plantBatches))
      .orderBy(asc(plantBatches.status), desc(plantBatches.createdAt))
      .limit(50),
    db
      .select({ id: strains.id, name: strains.name })
      .from(strains)
      .where(and(eq(strains.orgId, session.orgId), eq(strains.active, true)))
      .orderBy(asc(strains.name)),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(inFacility(locations)).orderBy(asc(locations.name)),
    db
      .select({
        id: cultivationTasks.id,
        title: cultivationTasks.title,
        dueDate: cultivationTasks.dueDate,
        roomName: locations.name,
      })
      .from(cultivationTasks)
      .leftJoin(locations, eq(locations.id, cultivationTasks.locationId))
      .where(and(inFacility(cultivationTasks), eq(cultivationTasks.done, false)))
      .orderBy(sql`${cultivationTasks.dueDate} asc nulls last`, asc(cultivationTasks.createdAt))
      .limit(50),
  ]);
  const countOf = (phase: string) => phaseCounts.find((p) => p.phase === phase)?.count ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  const tiles = [
    // Young plants are counted in their batches: the tile jumps to the batch list below.
    { label: "Untagged young plants", value: immature.count, href: "/cultivation#batches" },
    { label: "Vegetative", value: countOf("VEGETATIVE"), href: "/cultivation/plants?phase=VEGETATIVE" },
    { label: "Flowering", value: countOf("FLOWERING"), href: "/cultivation/plants?phase=FLOWERING" },
    { label: "Harvests drying", value: drying, href: "/cultivation/harvests" },
  ];

  return (
    <>
      <PageHeader title="Cultivation" subtitle="From clone or seed to packaged harvest." />
      <CultivationTabs current="/cultivation" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
            <p className="text-sm text-slate-600">{tile.label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{tile.value}</p>
          </Link>
        ))}
      </div>

      {/* Each list sits beside the form that adds to it, so the two columns stay even. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div id="batches" className="min-w-0 scroll-mt-24">
        <Card title="Plant batches" className={canWrite ? "h-full" : undefined}>
          {batches.length === 0 ? (
            <p className="text-sm text-slate-600">No batches yet. Start one with clones or seeds.</p>
          ) : (
            <ScrollBox label="Plant batches">
            <ul className="divide-y divide-slate-100 text-sm">
              {batches.map((batch) => (
                <li key={batch.id}>
                  <Link href={`/cultivation/batches/${batch.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:text-brand-700">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold">{batch.name}</span>{" "}
                      <span className="text-slate-600">
                        · {batch.strainName} · {batch.source.toLowerCase()}s · {batch.roomName}
                      </span>
                    </span>
                    <span className={`shrink-0 whitespace-nowrap ${batch.status === "CLOSED" ? "text-slate-400" : "font-semibold text-slate-900"}`}>
                      {batch.status === "CLOSED" ? "all tagged" : `${batch.untaggedCount} of ${batch.initialCount} untagged`} ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            </ScrollBox>
          )}
        </Card>
        </div>
        {canWrite ? (
          <Card title="Start a batch" className="h-full">
            <ActionForm action={batchAction} submitLabel="Start batch">
              <Field label="Batch name">
                <input name="name" required className={inputClass} />
              </Field>
              {/* A missing strain or room is added right here, without leaving the batch. */}
              <CreatableSelect
                name="strainId"
                label="Strain"
                required
                placeholder="Choose a strain"
                options={strainRows.map((s) => ({ id: s.id, label: s.name }))}
                create={{
                  buttonLabel: "Add strain",
                  title: "Add a strain",
                  intro: "It's saved to your Strains list and picked for this batch.",
                  submitLabel: "Save strain",
                  action: quickStrainAction,
                  fields: <StrainFields />,
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Started from">
                  <select name="source" defaultValue="CLONE" className={inputClass}>
                    <option value="CLONE">Clones</option>
                    <option value="SEED">Seeds</option>
                  </select>
                </Field>
                <Field label="How many">
                  <input name="count" inputMode="numeric" required className={inputClass} />
                </Field>
              </div>
              <CreatableSelect
                name="locationId"
                label="Room"
                required
                placeholder="Choose a room"
                options={rooms.map((r) => ({ id: r.id, label: r.name }))}
                create={
                  canAddRoom
                    ? {
                        buttonLabel: "Add room",
                        title: "Add a room",
                        intro: "It's added to this facility's rooms and picked for this batch.",
                        submitLabel: "Save room",
                        action: quickRoomAction,
                        fields: <RoomFields />,
                      }
                    : undefined
                }
                deniedHint="Room missing? Ask a manager to add it in Settings → Facilities."
              />
            </ActionForm>
          </Card>
        ) : null}
        <Card title="Open tasks" className={canWrite ? "h-full" : undefined}>
          {tasks.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing on the list.</p>
          ) : (
            <ScrollBox label="Open tasks">
            <ul className="divide-y divide-slate-100 text-sm">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium text-slate-900">{task.title}</p>
                    <p className={task.dueDate && task.dueDate < today ? "font-semibold text-red-700" : "text-slate-600"}>
                      {task.dueDate ? `Due ${task.dueDate}${task.dueDate < today ? " (overdue)" : ""}` : "No due date"}
                      {task.roomName ? ` · ${task.roomName}` : ""}
                    </p>
                  </div>
                  {canWrite ? (
                    <form action={completeTaskAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <button type="submit" className="min-h-10 rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">
                        Done
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
            </ScrollBox>
          )}
        </Card>
        {canWrite ? (
          <Card title="Add a task" className="h-full">
            <ActionForm action={taskAction} submitLabel="Add task">
              <Field label="What needs doing">
                <input name="title" required maxLength={200} className={inputClass} />
              </Field>
              <Field label="Due date (optional)">
                <input name="dueDate" type="date" className={inputClass} />
              </Field>
              <Field label="Room (optional)">
                <select name="locationId" defaultValue="" className={inputClass}>
                  <option value="">Any</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
