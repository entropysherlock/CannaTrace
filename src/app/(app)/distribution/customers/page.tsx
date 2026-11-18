import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { DistributionTabs } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, destinations } from "@/db/schema";
import { db } from "@/lib/db";
import { licenseProblem } from "@/lib/distribution-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { customerAction } from "../actions";
import { facilityToday } from "@/lib/time";

export default async function CustomersPage() {
  const session = await requirePagePermission("sales.view");
  const [rows, dests] = await Promise.all([
    db.select().from(customers).where(eq(customers.orgId, session.orgId)).orderBy(asc(customers.name)),
    db.select().from(destinations).where(eq(destinations.orgId, session.orgId)),
  ]);
  const today = await facilityToday(session.facilityId);

  return (
    <>
      <PageHeader title="Vendors" subtitle="Licensed businesses you sell to or buy from, and the locations you ship to. Shared across your facilities." />
      <DistributionTabs current="/distribution/customers" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No vendors yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {rows.map((customer) => {
                const theirs = dests.filter((d) => d.vendorId === customer.id && d.active);
                const ready = theirs.filter((d) => !licenseProblem(d, today)).length;
                const roles = [customer.weSellTo ? "we sell to" : null, customer.weBuyFrom ? "we buy from" : null].filter(Boolean).join(" · ");
                return (
                  <li key={customer.id}>
                    <Link href={`/distribution/customers/${customer.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-brand-50">
                      <div>
                        <p className="font-semibold text-slate-900">{customer.name}</p>
                        <p className="text-sm text-slate-600">
                          {roles} · {customer.licenseNumber}
                          {customer.active ? "" : " · inactive"}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold ${customer.weSellTo && ready === 0 ? "text-red-700" : "text-brand-700"}`}>
                        {theirs.length} destination{theirs.length === 1 ? "" : "s"}
                        {customer.weSellTo ? ` · ${ready ? `${ready} ready to ship` : "none ready to ship"}` : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {can(session, "sales.write") ? (
          <Card title="Add a vendor">
            <ActionForm action={customerAction} submitLabel="Add vendor">
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="mb-1 text-sm font-medium text-slate-700">This vendor is one</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="weSellTo" defaultChecked className="h-5 w-5 accent-brand-700" /> we sell to
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="weBuyFrom" className="h-5 w-5 accent-brand-700" /> we buy from
                </label>
              </fieldset>
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
              <Field label="Address (optional)" hint="Their license and address become their first destination. Add more on their page.">
                <input name="address" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
