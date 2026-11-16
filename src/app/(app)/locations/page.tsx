import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { locationTypeEnum, locations, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { addLocation } from "../catalog/actions";

export default async function LocationsPage() {
  const session = await requirePagePermission("catalog.manage");
  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      packageCount: sql<number>`count(${packages.id})::int`,
    })
    .from(locations)
    .leftJoin(
      packages,
      and(eq(packages.locationId, locations.id), inArray(packages.status, ["ACTIVE", "ON_HOLD", "QUARANTINE"])),
    )
    .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
    .groupBy(locations.id)
    .orderBy(asc(locations.name));

  return (
    <>
      <PageHeader title="Locations" subtitle="Rooms, racks, and bins at this facility." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`${rows.length} location${rows.length === 1 ? "" : "s"}`}>
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium text-slate-900">{row.name}</span>{" "}
                    <span className="text-slate-500">· {row.type.toLowerCase()}</span>
                  </span>
                  <span className="text-slate-600">
                    {row.packageCount} package{row.packageCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card title="Add a location">
          <ActionForm action={addLocation} submitLabel="Add location">
            <Field label="Name" hint='For example "Vault B / Rack 3".'>
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Type">
              <select name="type" required defaultValue="RACK" className={inputClass}>
                {locationTypeEnum.enumValues.map((t) => (
                  <option key={t} value={t}>
                    {t.toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
