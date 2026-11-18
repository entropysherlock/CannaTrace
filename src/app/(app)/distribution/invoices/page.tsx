import Decimal from "decimal.js";
import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { DistributionTabs, Pill, usd } from "@/components/distribution-ui";
import { PageHeader } from "@/components/ui";
import { customers, invoices, payments } from "@/db/schema";
import { db } from "@/lib/db";
import { invoiceBalance } from "@/lib/distribution-math";
import { requirePagePermission } from "@/lib/session";
import { facilityToday } from "@/lib/time";

export default async function InvoicesPage() {
  const session = await requirePagePermission("sales.view");
  const rows = await db
    .select({
      id: invoices.id,
      orderId: invoices.orderId,
      number: invoices.number,
      total: invoices.total,
      dueDate: invoices.dueDate,
      customerName: customers.name,
      paid: sql<string>`coalesce((select sum(${payments.amount}) from ${payments} where ${payments.invoiceId} = ${invoices.id}), 0)`,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.orgId, session.orgId), eq(invoices.facilityId, session.facilityId)))
    .orderBy(desc(invoices.createdAt))
    .limit(200);
  const today = await facilityToday(session.facilityId);
  const withState = rows.map((row) => ({ ...row, ...invoiceBalance(row.total, [row.paid]) }));
  const owed = withState.reduce((sum, row) => sum.add(Decimal.max(row.balance, 0)), new Decimal(0));

  return (
    <>
      <PageHeader title="Invoices" subtitle={`${usd(owed)} owed to you across ${withState.filter((r) => r.state !== "PAID").length} unpaid invoices`} />
      <DistributionTabs current="/distribution/invoices" />
      {withState.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No invoices yet. One is created automatically when an order ships.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {withState.map((invoice) => (
            <li key={invoice.id}>
              <Link href={`/distribution/orders/${invoice.orderId}/invoice`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-brand-50">
                <div>
                  <p className="font-semibold text-slate-900">
                    {invoice.number} <Pill status={invoice.state !== "PAID" && invoice.dueDate < today ? "OVERDUE" : invoice.state} />
                  </p>
                  <p className="text-sm text-slate-600">
                    {invoice.customerName} · due {invoice.dueDate}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold text-slate-900">{usd(invoice.total)}</p>
                  {invoice.state !== "PAID" ? <p className="text-slate-600">{usd(invoice.balance)} owed</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
