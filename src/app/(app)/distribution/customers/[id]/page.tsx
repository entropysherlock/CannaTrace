import { Info } from "lucide-react";
import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { DistributionTabs, Pill } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, orders, priceLists } from "@/db/schema";
import { db } from "@/lib/db";
import { licenseProblem, todayIn } from "@/lib/distribution-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { customerPriceListAction, verifyLicenseAction } from "../../actions";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("sales.view");
  const { id } = await params;
  const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, session.orgId)));
  if (!customer) notFound();
  const [lists, history] = await Promise.all([
    db.select().from(priceLists).where(eq(priceLists.orgId, session.orgId)).orderBy(asc(priceLists.name)),
    db
      .select({ id: orders.id, number: orders.number, status: orders.status, createdAt: orders.createdAt })
      .from(orders)
      .where(and(eq(orders.customerId, customer.id), eq(orders.facilityId, session.facilityId)))
      .orderBy(desc(orders.createdAt))
      .limit(20),
  ]);
  const problem = licenseProblem(customer, todayIn());
  const canWrite = can(session, "sales.write");
  const hidden = <input type="hidden" name="customerId" value={customer.id} />;

  return (
    <>
      <PageHeader title={customer.name} subtitle={`${customer.licenseType} · license ${customer.licenseNumber}`} />
      <DistributionTabs current="/distribution/customers" />
      {problem ? (
        <p role="status" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {problem}
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Details">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-600">License expires</dt>
            <dd className="text-right font-semibold">{customer.licenseExpires}</dd>
            <dt className="text-slate-600">Last verified</dt>
            <dd className="text-right">
              {customer.licenseVerifiedAt ? `${customer.licenseVerifiedAt.toLocaleDateString("en-US")} by ${customer.licenseVerifiedBy}` : "never"}
            </dd>
            <dt className="text-slate-600">Payment terms</dt>
            <dd className="text-right">{customer.paymentTermsDays === 0 ? "on delivery" : `net ${customer.paymentTermsDays} days`}</dd>
            <dt className="text-slate-600">Contact</dt>
            <dd className="text-right">{customer.contactName ?? "none"}</dd>
            <dt className="text-slate-600">Email</dt>
            <dd className="break-all text-right">{customer.email ?? "none"}</dd>
            <dt className="text-slate-600">Phone</dt>
            <dd className="text-right">{customer.phone ?? "none"}</dd>
            <dt className="text-slate-600">Address</dt>
            <dd className="text-right">{customer.address ?? "none"}</dd>
          </dl>
        </Card>

        {canWrite ? (
          <div className="space-y-5">
            <Card title="Verify license">
              <ActionForm action={verifyLicenseAction} submitLabel="Mark as verified">
                {hidden}
                <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Look this license up on the state regulator&apos;s site first. Marking it verified records your name and today&apos;s date.</span></p>
                <Field label="New expiry date (only if it changed)">
                  <input name="licenseExpires" type="date" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
            <Card title="Price list">
              <ActionForm action={customerPriceListAction} submitLabel="Save price list">
                {hidden}
                <Field label="This customer pays" hint="Items missing from their list use the default list.">
                  <select name="priceListId" defaultValue={customer.priceListId ?? ""} className={inputClass}>
                    <option value="">Default prices</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                        {list.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
            </Card>
          </div>
        ) : null}

        <Card title="Orders at this facility">
          {history.length === 0 ? (
            <p className="text-sm text-slate-600">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {history.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/distribution/orders/${order.id}`} className="font-semibold text-brand-700 hover:underline">
                    {order.number}
                  </Link>
                  <span className="flex items-center gap-2 text-slate-600">
                    {order.createdAt.toLocaleDateString("en-US")} <Pill status={order.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
