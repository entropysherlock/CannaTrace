import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Disclosure } from "@/components/disclosure";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { equipment, equipmentLogs, locations } from "@/db/schema";
import { db } from "@/lib/db";
import { dueStatus, worst, type DueState } from "@/lib/equipment-math";
import { can } from "@/lib/rbac";
import { requireAnyPagePermission } from "@/lib/session";
import { facilityToday } from "@/lib/time";
import { createEquipmentAction, equipmentStatusAction, logEventAction } from "./actions";

export const metadata = { title: "Equipment · Leaf2Sale" };

const BADGE: Record<DueState, { label: string; tone: string }> = {
  none: { label: "No schedule", tone: "bg-slate-100 text-slate-600" },
  ok: { label: "Up to date", tone: "bg-emerald-100 text-emerald-800" },
  soon: { label: "Due soon", tone: "bg-amber-100 text-amber-900" },
  overdue: { label: "Overdue", tone: "bg-red-100 text-red-800" },
};
const STATUS: Record<string, string> = { ACTIVE: "Active", DOWN: "Out of service", RETIRED: "Retired" };
const RANK: Record<DueState, number> = { overdue: 0, soon: 1, ok: 2, none: 3 };

function dueText(label: string, d: ReturnType<typeof dueStatus>) {
  if (d.state === "none") return `${label}: no schedule`;
  const when = d.daysLeft! < 0 ? `${-d.daysLeft!} day${d.daysLeft === -1 ? "" : "s"} overdue` : d.daysLeft === 0 ? "due today" : `due in ${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"}`;
  return `${label}: ${when} (${d.nextDue})`;
}

export default async function EquipmentPage() {
  const session = await requireAnyPagePermission("manufacturing.write", "audit.view");
  const canWrite = can(session, "manufacturing.write");
  const today = await facilityToday(session.facilityId);
  const [rows, rooms] = await Promise.all([
    db
      .select({ e: equipment, location: locations.name })
      .from(equipment)
      .leftJoin(locations, eq(locations.id, equipment.locationId))
      .where(and(eq(equipment.orgId, session.orgId), eq(equipment.facilityId, session.facilityId)))
      .orderBy(asc(equipment.name)),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId))).orderBy(asc(locations.name)),
  ]);
  const logs = rows.length
    ? await db.select().from(equipmentLogs).where(inArray(equipmentLogs.equipmentId, rows.map((r) => r.e.id))).orderBy(desc(equipmentLogs.doneOn), desc(equipmentLogs.createdAt)).limit(400)
    : [];
  const view = rows
    .map(({ e, location }) => {
      const maint = dueStatus({ everyDays: e.maintenanceEveryDays, lastOn: e.lastMaintainedOn, since: e.createdAt.toISOString().slice(0, 10), today });
      const calib = dueStatus({ everyDays: e.calibrationEveryDays, lastOn: e.lastCalibratedOn, since: e.createdAt.toISOString().slice(0, 10), today });
      return { e, location, maint, calib, state: e.status === "RETIRED" ? ("none" as DueState) : worst(maint.state, calib.state) };
    })
    .sort((a, b) => Number(a.e.status === "RETIRED") - Number(b.e.status === "RETIRED") || RANK[a.state] - RANK[b.state] || a.e.name.localeCompare(b.e.name));
  const live = view.filter((v) => v.e.status !== "RETIRED");
  const overdue = live.filter((v) => v.state === "overdue").length;
  const soon = live.filter((v) => v.state === "soon").length;
  const down = live.filter((v) => v.e.status === "DOWN").length;

  return (
    <>
      <PageHeader title="Equipment" subtitle="Presses, extractors, dryers and scales: what you have, what is due, and what each run used." />
      <ManufacturingTabs current="/manufacturing/equipment" />
      <p className="mb-4 flex flex-wrap gap-2 text-xs font-semibold" aria-label="Equipment summary">
        <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-800">{overdue} overdue</span>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">{soon} due soon</span>
        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-700">{down} out of service</span>
      </p>
      {canWrite ? (
        <div className="mb-5">
          <Disclosure title="Add equipment" defaultOpen={rows.length === 0}>
            <ActionForm action={createEquipmentAction} submitLabel="Add equipment" className="grid gap-3 p-4 pt-0 sm:grid-cols-2">
              <Field label="Name">
                <input name="name" required maxLength={120} placeholder="Rosin press 1" className={inputClass} />
              </Field>
              <Field label="Kind">
                <input name="kind" required maxLength={60} placeholder="press, extractor, dryer, scale" className={inputClass} />
              </Field>
              <Field label="Serial number (optional)">
                <input name="serialNumber" maxLength={80} className={inputClass} />
              </Field>
              <Field label="Where it is (optional)">
                <select name="locationId" defaultValue="" className={inputClass}>
                  <option value="">Not set</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Maintenance every (days, optional)">
                <input name="maintenanceEveryDays" inputMode="numeric" placeholder="90" className={inputClass} />
              </Field>
              <Field label="Calibration every (days, optional)">
                <input name="calibrationEveryDays" inputMode="numeric" placeholder="365" className={inputClass} />
              </Field>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}
      {view.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No equipment yet.</p> : null}
      <div className="grid gap-5 md:grid-cols-2">
        {view.map(({ e, location, maint, calib, state }) => (
          <Card
            key={e.id}
            title={e.name}
            action={
              <span className="flex flex-wrap gap-1.5 text-xs font-bold">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{STATUS[e.status] ?? e.status}</span>
                {e.status !== "RETIRED" ? <span className={`rounded-full px-2 py-0.5 ${BADGE[state].tone}`}>{BADGE[state].label}</span> : null}
              </span>
            }
          >
            <div className="space-y-1 text-sm text-slate-700">
              <p>
                {e.kind}
                {e.serialNumber ? ` · serial ${e.serialNumber}` : ""}
                {location ? ` · ${location}` : ""}
              </p>
              <p>{dueText("Maintenance", maint)}</p>
              <p>{dueText("Calibration", calib)}</p>
            </div>
            {logs.filter((l) => l.equipmentId === e.id).slice(0, 3).length > 0 ? (
              <ul className="mt-3 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-600">
                {logs
                  .filter((l) => l.equipmentId === e.id)
                  .slice(0, 3)
                  .map((l) => (
                    <li key={l.id}>
                      {l.doneOn} · {l.kind.toLowerCase()} · {l.userName}
                      {l.note ? `: ${l.note}` : ""}
                    </li>
                  ))}
              </ul>
            ) : null}
            {canWrite && e.status !== "RETIRED" ? (
              <div className="mt-3 space-y-2">
                <Disclosure title="Log maintenance, calibration or a repair">
                  <ActionForm action={logEventAction} submitLabel="Log it" className="grid gap-3 p-4 pt-0 sm:grid-cols-2">
                    <input type="hidden" name="equipmentId" value={e.id} />
                    <Field label="What was done">
                      <select name="kind" defaultValue="MAINTENANCE" className={inputClass}>
                        <option value="MAINTENANCE">Maintenance</option>
                        <option value="CALIBRATION">Calibration</option>
                        <option value="REPAIR">Repair</option>
                        <option value="NOTE">Note</option>
                      </select>
                    </Field>
                    <Field label="Date (blank is today)">
                      <input name="doneOn" placeholder="YYYY-MM-DD" maxLength={10} className={inputClass} />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Note (optional)">
                        <input name="note" maxLength={500} className={inputClass} />
                      </Field>
                    </div>
                  </ActionForm>
                </Disclosure>
                <Disclosure title="Change status">
                  <ActionForm action={equipmentStatusAction} submitLabel="Save status" className="grid gap-3 p-4 pt-0 sm:grid-cols-2">
                    <input type="hidden" name="equipmentId" value={e.id} />
                    <Field label="Status">
                      <select name="status" defaultValue={e.status} className={inputClass}>
                        <option value="ACTIVE">Active</option>
                        <option value="DOWN">Out of service</option>
                        <option value="RETIRED">Retired</option>
                      </select>
                    </Field>
                    <Field label="Why (optional)">
                      <input name="reason" maxLength={300} className={inputClass} />
                    </Field>
                  </ActionForm>
                </Disclosure>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
