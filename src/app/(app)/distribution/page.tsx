import { and, asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { DistributionTabs, Pill, usd } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, destinations, orderLines, orders } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { orderAction } from "./actions";

export default async function OrdersPage() {
  const session = await requirePagePermission("sales.view");
  const [rows, customerRows] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        createdAt: orders.createdAt,
        customerName: customers.name,
        total: sql<string>`coalesce((select sum(round(${orderLines.quantity} * ${orderLines.unitPrice}, 2)) from ${orderLines} where ${orderLines.orderId} = ${orders.id}), 0)`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.orgId, session.orgId), eq(orders.facilityId, session.facilityId)))
      .orderBy(desc(orders.createdAt))
      .limit(100),
    db
      .select({ id: destinations.id, name: destinations.name, license: destinations.licenseNumber, vendorId: customers.id, vendor: customers.name })
      .from(destinations)
      .innerJoin(customers, eq(customers.id, destinations.vendorId))
      .where(and(eq(destinations.orgId, session.orgId), eq(destinations.active, true), eq(customers.active, true), eq(customers.weSellTo, true)))
      .orderBy(asc(customers.name), asc(destinations.name)),
  ]);
  const vendorsWithDestinations = [...new Map(customerRows.map((d) => [d.vendorId, d.vendor])).entries()];

  return (
    <>
      <PageHeader title="Distribution" subtitle="Wholesale orders from draft to delivered and paid." />
      <DistributionTabs current="/distribution" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
              No orders yet. Add a customer, then start an order.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {rows.map((order) => (
                <li key={order.id}>
                  <Link href={`/distribution/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-brand-50">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {order.number} <Pill status={order.status} />
                      </p>
                      <p className="text-sm text-slate-600">
                        {order.customerName} · {order.createdAt.toLocaleDateString("en-US")}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{usd(order.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {can(session, "sales.write") ? (
          <Card title="Start an order">
            {customerRows.length === 0 ? (
              <p className="text-sm text-slate-600">
                Add a vendor you sell to, with a destination, on the{" "}
                <Link href="/distribution/customers" className="font-semibold text-brand-700 hover:underline">
                  Vendors
                </Link>{" "}
                tab.
              </p>
            ) : (
              <ActionForm action={orderAction} submitLabel="Start order">
                <Field label="Ship to" hint="Vendor and destination. Its license is checked when the order ships.">
                  <select name="destinationId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a vendor and destination
                    </option>
                    {vendorsWithDestinations.map(([vendorId, vendor]) => (
                      <optgroup key={vendorId} label={vendor}>
                        {customerRows
                          .filter((d) => d.vendorId === vendorId)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name === vendor ? vendor : `${vendor} – ${d.name}`} ({d.license})
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="Notes (optional)">
                  <input name="notes" maxLength={500} className={inputClass} />
                </Field>
              </ActionForm>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
