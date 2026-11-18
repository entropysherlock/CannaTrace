import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { StateSelect } from "@/components/state-select";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { facilities as facilitiesTable, licenseTypeEnum, locations } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ROOM_AREAS, roomAreaLabel } from "@/lib/rooms";
import { requirePagePermission } from "@/lib/session";
import { hasRulePack, stateName } from "@/lib/states";
import { SAMPLE_LICENSE } from "@/lib/demo/sample-facility";
import { addFacilityAction, addRoomAction, loadSampleFacilityAction, switchFacility, updateFacilityAction, updateRoomAction } from "../actions";

export const instant = false;
// Loading the sample facility makes a few thousand records; give it time on the server.
export const maxDuration = 300;

const typeLabel = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

function FacilityFields({ f }: { f?: { name: string; licenseNumber: string; licenseType: string; state: string } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Facility name">
        <input name="name" required maxLength={100} defaultValue={f?.name} className={inputClass} />
      </Field>
      <Field label="State license number">
        <input name="licenseNumber" required maxLength={60} defaultValue={f?.licenseNumber} className={inputClass} />
      </Field>
      <Field label="License type">
        <select name="licenseType" required defaultValue={f?.licenseType ?? ""} className={inputClass}>
          <option value="" disabled>
            Choose one
          </option>
          {licenseTypeEnum.enumValues.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="State" hint="States where adult-use sales are legal and CannaTrace has the state's rules built in. The state decides which rules apply here: purchase limits, minimum age, and testing before sale.">
        <StateSelect defaultValue={f?.state} />
      </Field>
    </div>
  );
}

function RoomFields({ room }: { room?: { name: string; area: string | null } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Room area type">
        <select name="area" required defaultValue={room?.area ?? ""} className={inputClass}>
          <option value="" disabled>
            Choose one
          </option>
          {ROOM_AREAS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Room name" hint='Any name you like, for example "Flower Room 2".'>
        <input name="name" required maxLength={80} defaultValue={room?.name} className={inputClass} />
      </Field>
    </div>
  );
}

type Room = { id: string; facilityId: string; name: string; area: string | null };

function Rooms({ facilityId, rooms }: { facilityId: string; rooms: Room[] }) {
  // List rooms in the order a plant moves through the building, then by name.
  const order = (r: Room) => {
    const i = ROOM_AREAS.findIndex((a) => a.value === r.area);
    return i === -1 ? ROOM_AREAS.length : i;
  };
  const sorted = [...rooms].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return (
    <div className="mb-4 border-t border-slate-100 pt-4" data-testid="facility-rooms">
      <h3 className="mb-2 text-sm font-bold text-slate-900">
        Rooms <span className="font-normal text-slate-500">({rooms.length})</span>
      </h3>
      {sorted.length === 0 ? (
        <p className="mb-3 text-sm text-slate-600">No rooms yet. Add the first one below.</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {sorted.map((r) => (
            <li key={r.id} className="py-2">
              <details>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{r.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.area ? "bg-brand-50 text-brand-800" : "bg-slate-100 text-slate-600"}`}>
                      {roomAreaLabel(r.area) ?? "No area type"}
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-brand-700">Edit</span>
                </summary>
                <div className="mt-3">
                  <ActionForm action={updateRoomAction} submitLabel="Save room">
                    <input type="hidden" name="roomId" value={r.id} />
                    <RoomFields room={r} />
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-brand-700">Add a room</summary>
        <div className="mt-3">
          <ActionForm action={addRoomAction} submitLabel="Add room">
            <input type="hidden" name="facilityId" value={facilityId} />
            <RoomFields />
          </ActionForm>
        </div>
      </details>
    </div>
  );
}

export default async function FacilitiesPage() {
  const session = await requirePagePermission("settings.manage");
  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.orgId, session.orgId)).orderBy(asc(facilitiesTable.name));
  const sample = facilities.find((f) => f.licenseNumber === SAMPLE_LICENSE);
  const rooms = await db
    .select({ id: locations.id, facilityId: locations.facilityId, name: locations.name, area: locations.area })
    .from(locations)
    .where(and(eq(locations.orgId, session.orgId), eq(locations.type, "ROOM")));

  return (
    <>
      <PageHeader title="Facilities" subtitle={`${facilities.length} facilit${facilities.length === 1 ? "y" : "ies"}. Each one keeps its own inventory, plants, sales, and state rules.`} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {facilities.map((f) => {
            const current = f.id === session.facilityId;
            return (
              <Card
                key={f.id}
                title={f.name}
                action={
                  current ? (
                    <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold uppercase text-white">You&apos;re here</span>
                  ) : (
                    <form action={switchFacility}>
                      <input type="hidden" name="facilityId" value={f.id} />
                      <button type="submit" className="text-sm font-semibold text-brand-700 hover:underline">
                        Switch to this facility
                      </button>
                    </form>
                  )
                }
              >
                <dl className="mb-4 grid grid-cols-2 gap-y-1 text-sm sm:grid-cols-4" data-testid="facility-details">
                  <dt className="text-slate-600">License</dt>
                  <dd className="font-semibold">{f.licenseNumber}</dd>
                  <dt className="text-slate-600">Type</dt>
                  <dd className="font-semibold">{typeLabel(f.licenseType)}</dd>
                  <dt className="text-slate-600">State</dt>
                  <dd className="font-semibold">{stateName(f.state)}</dd>
                  <dt className="text-slate-600">State rules</dt>
                  <dd className="font-semibold">{hasRulePack(f.state) ? "Built in" : "Not built in yet"}</dd>
                </dl>
                <Rooms facilityId={f.id} rooms={rooms.filter((r) => r.facilityId === f.id)} />
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-brand-700">Edit this facility</summary>
                  <div className="mt-3">
                    <ActionForm action={updateFacilityAction} submitLabel="Save facility">
                      <input type="hidden" name="facilityId" value={f.id} />
                      <FacilityFields f={f} />
                      <p className="text-xs text-slate-600">
                        Changing the state switches which state&apos;s rules apply here from now on. Past records keep what happened at the time. To change the state reporting system, use{" "}
                        {can(session, "compliance.manage") ? (
                          <Link href="/compliance" className="font-semibold text-brand-700 underline">
                            State reporting
                          </Link>
                        ) : (
                          "State reporting"
                        )}
                        .
                      </p>
                    </ActionForm>
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
        <div className="space-y-5">
        <Card title="Add a facility">
          <ActionForm action={addFacilityAction} submitLabel="Add facility">
            <FacilityFields />
            <p className="text-xs text-slate-600">
              A new facility starts empty. Add its rooms on its card here once it&apos;s created. Everyone on your team can switch to it.
            </p>
          </ActionForm>
        </Card>
        {sample ? (
          <Card title="Try every feature with sample data">
            <div className="space-y-3 text-sm text-slate-700" data-testid="sample-loaded">
              <p>
                <span className="font-semibold">{sample.name}</span> is loaded. Switch to it to try cultivation, labels, wholesale, and the register with realistic data.
              </p>
              {sample.id === session.facilityId ? (
                <p className="font-semibold text-brand-800">You&apos;re in it now.</p>
              ) : (
                <form action={switchFacility}>
                  <input type="hidden" name="facilityId" value={sample.id} />
                  <button type="submit" className="min-h-11 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">
                    Switch to the sample facility
                  </button>
                </form>
              )}
            </div>
          </Card>
        ) : session.role === "OWNER" && !session.isDemo ? (
          <Card title="Try every feature with sample data">
            <ActionForm action={loadSampleFacilityAction} submitLabel="Load the sample facility">
              <p className="text-sm text-slate-700">
                Adds a separate facility, <span className="font-semibold">Sample Grow &amp; Store (practice data)</span>, filled like a real New Mexico microbusiness:
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                <li>12 rooms covering every area type, vault racks, and 4 strains</li>
                <li>About 100 plants from clone to flower, a drying harvest, and a finished one</li>
                <li>Packages with lab results and full cannabinoid profiles, one failed, one pending</li>
                <li>13 products with label details: flower, pre-rolls, live resin, gummies, a drink, a balm</li>
                <li>A production run, wholesale customers and orders, and a stocked register with sales</li>
              </ul>
              <p className="text-xs text-slate-600">
                Your other facilities aren&apos;t touched. Sample tags and SKUs start with SMP-. Like every record, it stays in the audit trail. Loading takes up to a minute.
              </p>
            </ActionForm>
          </Card>
        ) : null}
        </div>
      </div>
    </>
  );
}
