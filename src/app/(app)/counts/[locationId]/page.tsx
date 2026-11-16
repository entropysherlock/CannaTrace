import Decimal from "decimal.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { PageHeader, StatusBadge, inputClass } from "@/components/ui";
import { items, locations, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { cycleCountAction } from "../../inventory/actions";

export default async function CountLocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  const session = await requirePagePermission("inventory.adjust");
  const { locationId } = await params;
  const [location] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)));
  if (!location) notFound();

  const rows = await db
    .select({
      id: packages.id,
      tag: packages.tag,
      quantity: packages.quantity,
      unit: packages.unit,
      status: packages.status,
      itemName: items.name,
    })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .where(
      and(
        eq(packages.locationId, location.id),
        eq(packages.facilityId, session.facilityId),
        inArray(packages.status, ["ACTIVE", "ON_HOLD", "QUARANTINE"]),
      ),
    )
    .orderBy(asc(packages.tag));

  return (
    <>
      <PageHeader
        title={`Count: ${location.name}`}
        subtitle="Enter what you find for every package. Enter 0 for a package that is missing."
        action={
          <Link href="/counts" className="text-sm font-semibold text-emerald-700 hover:underline">
            Back to counts
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Nothing is stored here, so there is nothing to count.
        </p>
      ) : (
        <ActionForm action={cycleCountAction} submitLabel="Save count" className="max-w-2xl space-y-4">
          <input type="hidden" name="locationId" value={location.id} />
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
            {rows.map((pkg) => (
              <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <input type="hidden" name="packageId" value={pkg.id} />
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-slate-900">
                    {pkg.tag} {pkg.status !== "ACTIVE" ? <StatusBadge status={pkg.status} /> : null}
                  </p>
                  <p className="truncate text-sm text-slate-600">
                    {pkg.itemName} · system says {new Decimal(pkg.quantity).toString()} {unitLabel(pkg.unit)}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="sr-only">Counted amount for {pkg.tag}</span>
                  <input
                    name={`counted:${pkg.id}`}
                    inputMode="decimal"
                    required
                    placeholder="Counted"
                    className={`${inputClass} w-32`}
                  />
                  {unitLabel(pkg.unit)}
                </label>
              </li>
            ))}
          </ul>
        </ActionForm>
      )}
    </>
  );
}
