import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { DistributionTabs } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers } from "@/db/schema";
import { db } from "@/lib/db";
import { licenseProblem, todayIn } from "@/lib/distribution-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { customerAction } from "../actions";

export default async function CustomersPage() {
  const session = await requirePagePermission("sales.view");
  const rows = await db.select().from(customers).where(eq(customers.orgId, session.orgId)).orderBy(asc(customers.name));
  const today = todayIn();

  return (
    <>
      <PageHeader title="Customers" subtitle="Licensed businesses you sell to. Shared across your facilities." />
      <DistributionTabs current="/distribution/customers" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No customers yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {rows.map((customer) => {
                const problem = licenseProblem(customer, today);
                return (
                  <li key={customer.id}>
                    <Link href={`/distribution/customers/${customer.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-emerald-50">
                      <div>
                        <p className="font-semibold text-slate-900">{customer.name}</p>
                        <p className="text-sm text-slate-600">
                          {customer.licenseType} · {customer.licenseNumber} · expires {customer.licenseExpires}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold ${problem ? "text-red-700" : "text-emerald-700"}`}>
                        {problem ? "cannot sell yet" : "license verified"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {can(session.role, "sales.write") ? (
          <Card title="Add a customer">
            <ActionForm action={customerAction} submitLabel="Add customer">
              <Field label="Business name">
                <input name="name" required className={inputClass} />
              </Field>
              <Field label="License number">
                <input name="licenseNumber" required autoCapitalize="characters" className={inputClass} />
              </Field>
              <Field label="License type" hint="For example Retailer, Manufacturer, or Courier.">
                <input name="licenseType" required className={inputClass} />
              </Field>
              <Field label="License expires">
                <input name="licenseExpires" type="date" required className={inputClass} />
              </Field>
              <Field label="Payment terms in days" hint="0 means payment on delivery.">
                <input name="paymentTermsDays" inputMode="numeric" defaultValue="0" className={inputClass} />
              </Field>
              <Field label="Contact name (optional)">
                <input name="contactName" className={inputClass} />
              </Field>
              <Field label="Email (optional)">
                <input name="email" type="email" className={inputClass} />
              </Field>
              <Field label="Phone (optional)">
                <input name="phone" className={inputClass} />
              </Field>
              <Field label="Delivery address (optional)">
                <input name="address" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
