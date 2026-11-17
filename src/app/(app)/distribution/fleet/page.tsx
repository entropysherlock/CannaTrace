import { asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { DistributionTabs } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { drivers, vehicles } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { driverAction, vehicleAction } from "../actions";

export default async function FleetPage() {
  const session = await requirePagePermission("sales.view");
  const [driverRows, vehicleRows] = await Promise.all([
    db.select().from(drivers).where(eq(drivers.orgId, session.orgId)).orderBy(asc(drivers.name)),
    db.select().from(vehicles).where(eq(vehicles.orgId, session.orgId)).orderBy(asc(vehicles.plate)),
  ]);
  const canWrite = can(session, "sales.write");

  return (
    <>
      <PageHeader title="Drivers and vehicles" subtitle="Printed on every transfer manifest." />
      <DistributionTabs current="/distribution/fleet" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="Drivers">
            {driverRows.length === 0 ? (
              <p className="text-sm text-slate-600">No drivers yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {driverRows.map((driver) => (
                  <li key={driver.id} className="flex justify-between gap-3 py-2">
                    <span className="font-medium text-slate-900">{driver.name}</span>
                    <span className="text-slate-600">
                      license {driver.licenseNumber}
                      {driver.phone ? ` · ${driver.phone}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canWrite ? (
            <Card title="Add a driver">
              <ActionForm action={driverAction} submitLabel="Add driver">
                <Field label="Name">
                  <input name="name" required className={inputClass} />
                </Field>
                <Field label="Driver's license number">
                  <input name="licenseNumber" required className={inputClass} />
                </Field>
                <Field label="Phone (optional)">
                  <input name="phone" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}
        </div>
        <div className="space-y-5">
          <Card title="Vehicles">
            {vehicleRows.length === 0 ? (
              <p className="text-sm text-slate-600">No vehicles yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {vehicleRows.map((vehicle) => (
                  <li key={vehicle.id} className="flex justify-between gap-3 py-2">
                    <span className="font-medium text-slate-900">
                      {vehicle.make} {vehicle.model}
                    </span>
                    <span className="font-mono text-slate-600">{vehicle.plate}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canWrite ? (
            <Card title="Add a vehicle">
              <ActionForm action={vehicleAction} submitLabel="Add vehicle">
                <Field label="Make">
                  <input name="make" required className={inputClass} />
                </Field>
                <Field label="Model">
                  <input name="model" required className={inputClass} />
                </Field>
                <Field label="License plate">
                  <input name="plate" required autoCapitalize="characters" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
