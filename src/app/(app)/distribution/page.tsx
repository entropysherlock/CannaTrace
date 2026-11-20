import { and, asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ShipToPicker } from "@/components/ship-to-picker";
import { DistributionTabs, MiniProgress, ORDER_NEXT, Pill, usd } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, destinations, orderLines, orders } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { orderAction } from "./actions";
import { facilityZone } from "@/lib/time";

export default async function OrdersPage() {
  const session = await requirePagePermission("sales.view");
  const zone = await facilityZone(session.facilityId);
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
  // Vendors you sell to, for "another location for …" in the add drawer.
  const sellTo = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.orgId, session.orgId), eq(customers.active, true), eq(customers.weSellTo, true)))
    .orderBy(asc(customers.name));

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
            <div className="space-y-5">
              {(
                [
                  ["In progress", ["DRAFT", "CONFIRMED", "PACKED"]],
                  ["On the road", ["SHIPPED"]],
                  ["Done", ["DELIVERED", "CANCELLED"]],
                ] as const
              ).map(([heading, statuses]) => {
                const group = rows.filter((o) => (statuses as readonly string[]).includes(o.status));
                if (!group.length) return null;
                return (
                  <section key={heading}>
                    <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                      {heading} · {group.length}
                    </h2>
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-brand-100 bg-white shadow-sm">
                      {group.map((order) => (
                        <li key={order.id}>
                          <Link href={`/distribution/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-brand-50">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900">
                                {order.number}
                                {order.status === "CANCELLED" ? (
                                  <>
                                    {" "}
                                    <Pill status={order.status} />
                                  </>
                                ) : null}
                              </p>
                              <p className="text-sm text-slate-600">
                                {order.customerName} · {order.createdAt.toLocaleDateString("en-US", { timeZone: zone })}
                              </p>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="flex flex-col items-end gap-1">
                                <span className={`text-xs font-semibold ${["CONFIRMED", "PACKED"].includes(order.status) ? "text-amber-700" : "text-slate-600"}`}>{ORDER_NEXT[order.status]}</span>
                                <MiniProgress status={order.status} />
                              </span>
                              <span className="w-24 text-right text-sm font-semibold text-slate-900">{usd(order.total)}</span>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
        {can(session, "sales.write") ? (
          <Card title="Start an order">
            <ActionForm action={orderAction} submitLabel="Start order">
              <ShipToPicker
                canAdd
                options={customerRows.map((d) => ({ id: d.id, label: `${d.name === d.vendor ? d.vendor : `${d.vendor} – ${d.name}`} (${d.license})`, group: d.vendor }))}
                vendors={sellTo}
              />
              <Field label="Notes (optional)">
                <input name="notes" maxLength={500} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
