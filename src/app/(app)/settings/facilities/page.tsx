import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { StateSelect } from "@/components/state-select";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { facilities as facilitiesTable, licenseTypeEnum } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { hasRulePack, stateName } from "@/lib/states";
import { addFacilityAction, switchFacility, updateFacilityAction } from "../actions";

export const instant = false;

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
      <Field label="State" hint="Decides which state's rules CannaTrace enforces here: purchase limits, minimum age, testing before sale, waste, and labels.">
        <StateSelect defaultValue={f?.state} />
      </Field>
    </div>
  );
}

export default async function FacilitiesPage() {
  const session = await requirePagePermission("settings.manage");
  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.orgId, session.orgId)).orderBy(asc(facilitiesTable.name));

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
        <Card title="Add a facility">
          <ActionForm action={addFacilityAction} submitLabel="Add facility">
            <FacilityFields />
            <p className="text-xs text-slate-600">
              A new facility starts empty. Switch to it from the menu at the top, then add rooms on Inventory → Locations. Everyone on your team can switch to it.
            </p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
