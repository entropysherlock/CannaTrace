import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { customers, drivers, facilities, items, orderAllocations, orders, packages, vehicles } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";

export default async function ManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("sales.view");
  const { id } = await params;
  const [row] = await db
    .select({ order: orders, customer: customers, facility: facilities, driver: drivers, vehicle: vehicles })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .innerJoin(facilities, eq(facilities.id, orders.facilityId))
    .innerJoin(drivers, eq(drivers.id, orders.driverId))
    .innerJoin(vehicles, eq(vehicles.id, orders.vehicleId))
    .where(and(eq(orders.id, id), eq(orders.orgId, session.orgId), eq(orders.facilityId, session.facilityId)));
  if (!row || !row.order.manifestNumber) notFound();
  const { order, customer, facility, driver, vehicle } = row;

  const rows = await db
    .select({ tag: packages.tag, lotNumber: packages.lotNumber, quantity: orderAllocations.quantity, itemName: items.name, unit: items.unit })
    .from(orderAllocations)
    .innerJoin(packages, eq(packages.id, orderAllocations.packageId))
    .innerJoin(items, eq(items.id, packages.itemId))
    .where(eq(orderAllocations.orderId, order.id))
    .orderBy(asc(packages.tag));

  const block = "rounded-md border border-slate-300 p-3";
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={`/distribution/orders/${order.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          Back to order
        </Link>
        <PrintButton label="Print manifest" />
      </div>
      <div className="bg-white p-6 text-sm text-slate-900 shadow-sm print:p-0 print:shadow-none">
        <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
          <div>
            <h1 className="text-xl font-bold">Transfer manifest</h1>
            <p>
              {order.manifestNumber} · order {order.number}
            </p>
          </div>
          <p className="text-right">
            Departs
            <br />
            <span className="font-semibold">{order.departAt?.replace("T", " at ")}</span>
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className={block}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</p>
            <p className="font-semibold">{facility.name}</p>
            <p>License {facility.licenseNumber}</p>
            <p>{facility.state}</p>
          </div>
          <div className={block}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</p>
            <p className="font-semibold">{customer.name}</p>
            <p>
              {customer.licenseType} license {customer.licenseNumber}
            </p>
            <p>{customer.address ?? "No address on file"}</p>
          </div>
          <div className={block}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Driver</p>
            <p className="font-semibold">{driver.name}</p>
            <p>Driver&apos;s license {driver.licenseNumber}</p>
            {driver.phone ? <p>{driver.phone}</p> : null}
          </div>
          <div className={block}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle</p>
            <p className="font-semibold">
              {vehicle.make} {vehicle.model}
            </p>
            <p>Plate {vehicle.plate}</p>
          </div>
        </div>
        {order.routeNotes ? <p className="mt-3">Route: {order.routeNotes}</p> : null}

        <table className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-slate-400">
              <th className="py-2 pr-2">Package tag</th>
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Lot</th>
              <th className="py-2 text-right">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((pkg) => (
              <tr key={pkg.tag} className="border-b border-slate-200">
                <td className="py-2 pr-2 font-mono font-semibold">{pkg.tag}</td>
                <td className="py-2 pr-2">{pkg.itemName}</td>
                <td className="py-2 pr-2">{pkg.lotNumber ?? ""}</td>
                <td className="py-2 text-right">
                  {new Decimal(pkg.quantity).toString()} {unitLabel(pkg.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-right font-semibold">
          {rows.length} package{rows.length === 1 ? "" : "s"}
        </p>

        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          <p className="border-t border-slate-500 pt-1">Released by (sign and date)</p>
          <p className="border-t border-slate-500 pt-1">Received by (sign and date)</p>
        </div>
        <p className="mt-6 text-xs text-slate-500">
          Internal manifest generated by CannaTrace. It does not replace the manifest your state track-and-trace system issues.
        </p>
      </div>
    </div>
  );
}
