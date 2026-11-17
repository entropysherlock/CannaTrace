import Decimal from "decimal.js";
import { and, asc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Pill, unitPrice, usd } from "@/components/distribution-ui";
import { PrintButton } from "@/components/print-button";
import { Card, Field, inputClass } from "@/components/ui";
import { customers, facilities, invoices, items, orderAllocations, orderLines, orders, payments } from "@/db/schema";
import { db } from "@/lib/db";
import { PAYMENT_METHODS, invoiceBalance, lineTotal, todayIn } from "@/lib/distribution-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { creditMemoAction, paymentAction } from "../../../actions";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("sales.view");
  const { id } = await params;
  const [row] = await db
    .select({ invoice: invoices, order: orders, customer: customers, facility: facilities })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(facilities, eq(facilities.id, invoices.facilityId))
    .where(and(eq(invoices.orderId, id), eq(invoices.orgId, session.orgId), eq(invoices.facilityId, session.facilityId)));
  if (!row) notFound();
  const { invoice, order, customer, facility } = row;

  const [lines, paid] = await Promise.all([
    db
      .select({
        itemName: items.name,
        unit: items.unit,
        unitPrice: orderLines.unitPrice,
        shipped: sql<string>`sum(${orderAllocations.quantity})`,
      })
      .from(orderAllocations)
      .innerJoin(orderLines, eq(orderLines.id, orderAllocations.orderLineId))
      .innerJoin(items, eq(items.id, orderLines.itemId))
      .where(eq(orderAllocations.orderId, order.id))
      .groupBy(items.name, items.unit, orderLines.unitPrice)
      .orderBy(asc(items.name)),
    db.select().from(payments).where(eq(payments.invoiceId, invoice.id)).orderBy(asc(payments.createdAt)),
  ]);
  const today = todayIn();
  const { balance, state, paid: paidTotal } = invoiceBalance(invoice.total, paid.map((p) => p.amount));
  const overdue = state !== "PAID" && invoice.dueDate < today;

  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
          <Link href={`/distribution/orders/${order.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
            Back to order
          </Link>
          <PrintButton label="Print invoice" />
        </div>
        <div className="bg-white p-6 text-sm text-slate-900 shadow-sm print:p-0 print:shadow-none">
          <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
            <div>
              <h1 className="text-xl font-bold">Invoice {invoice.number}</h1>
              <p>
                Order {order.number} · issued {invoice.createdAt.toLocaleDateString("en-US")}
              </p>
            </div>
            <p className="text-right">
              Due {invoice.dueDate}
              <br />
              <Pill status={overdue ? "OVERDUE" : state} />
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</p>
              <p className="font-semibold">{facility.name}</p>
              <p>License {facility.licenseNumber}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill to</p>
              <p className="font-semibold">{customer.name}</p>
              <p>License {customer.licenseNumber}</p>
              <p>{customer.address ?? ""}</p>
            </div>
          </div>
          <table className="mt-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-slate-400">
                <th className="py-2 pr-2">Item</th>
                <th className="py-2 pr-2 text-right">Shipped</th>
                <th className="py-2 pr-2 text-right">Price</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.itemName} className="border-b border-slate-200">
                  <td className="py-2 pr-2">{line.itemName}</td>
                  <td className="py-2 pr-2 text-right">
                    {new Decimal(line.shipped).toString()} {unitLabel(line.unit)}
                  </td>
                  <td className="py-2 pr-2 text-right">{unitPrice(line.unitPrice)}</td>
                  <td className="py-2 text-right">{usd(lineTotal(line.shipped, line.unitPrice))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto mt-3 grid w-full max-w-xs grid-cols-2 gap-y-1 text-right">
            <dt>Total</dt>
            <dd className="font-semibold">{usd(invoice.total)}</dd>
            <dt>Paid</dt>
            <dd>{usd(paidTotal)}</dd>
            <dt className="border-t border-slate-400 pt-1 font-bold">Balance due</dt>
            <dd className="border-t border-slate-400 pt-1 text-lg font-bold">{usd(Decimal.max(balance, 0))}</dd>
          </dl>
          <p className="mt-6 text-xs text-slate-500">Taxes are not calculated on this invoice.</p>
        </div>
      </div>

      <div className="space-y-5 print:hidden">
        <Card title="Payments and credits">
          {paid.length === 0 ? (
            <p className="text-sm text-slate-600">No payments or credits recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {paid.map((payment) => (
                <li key={payment.id} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium text-slate-900">
                      {payment.method === "CREDIT_MEMO" ? "Credit memo" : payment.method.toLowerCase()}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </span>
                    <span className="font-semibold">{usd(payment.amount)}</span>
                  </div>
                  <p className="text-slate-500">
                    {payment.paidOn} · recorded by {payment.userName}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {state !== "PAID" && can(session, "sales.write") ? (
          <Card title="Record a payment">
            <ActionForm action={paymentAction} submitLabel="Record payment">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <Field label="Amount in dollars" hint={`${usd(balance)} is still owed.`}>
                <input name="amount" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="How it was paid">
                <select name="method" required defaultValue="CHECK" className={inputClass}>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method === "ACH" ? "ACH" : method.charAt(0) + method.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date paid">
                <input name="paidOn" type="date" required defaultValue={today} className={inputClass} />
              </Field>
              <Field label="Check number or reference (optional)">
                <input name="reference" maxLength={100} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
        {state !== "PAID" && can(session, "sales.write") ? (
          <Card title="Issue a credit memo">
            <p className="mb-3 text-sm text-slate-600">Lowers what they owe without money changing hands, for returned product, a damaged delivery, or a price correction.</p>
            <ActionForm action={creditMemoAction} submitLabel="Issue credit" quiet>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <Field label="Credit in dollars" hint={`Up to ${usd(balance)}.`}>
                <input name="amount" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="What it's for">
                <input name="reason" required maxLength={200} className={inputClass} placeholder="Returned 2 cases, damaged in transit" />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
