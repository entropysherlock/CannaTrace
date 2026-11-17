import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Disclosure } from "@/components/disclosure";
import { DistributionTabs, Pill } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, destinations, orders, priceLists } from "@/db/schema";
import { db } from "@/lib/db";
import { licenseProblem, todayIn } from "@/lib/distribution-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { customerPriceListAction, destinationAction, destinationActiveAction, vendorDetailsAction, verifyDestinationAction } from "../../actions";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("sales.view");
  const { id } = await params;
  const [vendor] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, session.orgId)));
  if (!vendor) notFound();
  const [lists, history, places] = await Promise.all([
    db.select().from(priceLists).where(eq(priceLists.orgId, session.orgId)).orderBy(asc(priceLists.name)),
    db
      .select({ id: orders.id, number: orders.number, status: orders.status, createdAt: orders.createdAt, destination: destinations.name })
      .from(orders)
      .leftJoin(destinations, eq(destinations.id, orders.destinationId))
      .where(and(eq(orders.customerId, vendor.id), eq(orders.facilityId, session.facilityId)))
      .orderBy(desc(orders.createdAt))
      .limit(20),
    db.select().from(destinations).where(and(eq(destinations.vendorId, vendor.id), eq(destinations.orgId, session.orgId))).orderBy(asc(destinations.createdAt)),
  ]);
  const today = todayIn();
  const canWrite = can(session, "sales.write");
  const roles = [vendor.weSellTo ? "We sell to them" : null, vendor.weBuyFrom ? "We buy from them" : null].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title={vendor.name} subtitle={`${roles}${vendor.active ? "" : " · inactive"} · license ${vendor.licenseNumber}`} />
      <DistributionTabs current="/distribution/customers" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={`Destinations (${places.length})`}>
            <p className="mb-3 text-sm text-slate-600">Licensed locations you ship to. An order ships to one, and its license is checked before it leaves.</p>
            <ul className="space-y-3">
              {places.map((d) => {
                const problem = licenseProblem({ ...d, name: d.name }, today);
                return (
                  <li key={d.id} className="rounded-lg p-3 ring-1 ring-slate-200" aria-label={`Destination ${d.name}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {d.name}
                          {d.active ? "" : <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">inactive</span>}
                        </p>
                        <p className="text-sm text-slate-600">
                          {d.licenseType} · license {d.licenseNumber} · expires {d.licenseExpires}
                        </p>
                        {d.address ? <p className="text-sm text-slate-600">{d.address}</p> : null}
                        {d.contactName || d.phone || d.email ? (
                          <p className="text-sm text-slate-600">{[d.contactName, d.phone, d.email].filter(Boolean).join(" · ")}</p>
                        ) : null}
                        <p className={`mt-1 text-sm font-semibold ${problem ? "text-red-700" : "text-brand-700"}`}>
                          {problem ?? `License verified ${d.licenseVerifiedAt?.toLocaleDateString("en-US")} by ${d.licenseVerifiedBy}`}
                        </p>
                      </div>
                      {canWrite ? (
                        <ActionForm action={destinationActiveAction} submitLabel={d.active ? "Mark inactive" : "Make active"} quiet>
                          <input type="hidden" name="destinationId" value={d.id} />
                          <input type="hidden" name="active" value={d.active ? "false" : "true"} />
                        </ActionForm>
                      ) : null}
                    </div>
                    {canWrite && d.active ? (
                      <ActionForm action={verifyDestinationAction} submitLabel="Mark license verified" className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="destinationId" value={d.id} />
                        <label className="text-sm">
                          <span className="block text-slate-600">New expiry date (only if it changed)</span>
                          <input name="licenseExpires" type="date" aria-label={`New expiry date for ${d.name}`} className={inputClass} />
                        </label>
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {canWrite ? (
              <div className="mt-4">
                <Disclosure title="Add a destination">
                  <ActionForm action={destinationAction} submitLabel="Add destination" className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
                    <input type="hidden" name="vendorId" value={vendor.id} />
                    <Field label="Name" hint="For example the store's street or nickname.">
                      <input name="name" required className={inputClass} />
                    </Field>
                    <Field label="License number">
                      <input name="licenseNumber" required autoCapitalize="characters" className={inputClass} />
                    </Field>
                    <Field label="License type">
                      <input name="licenseType" required placeholder="Retailer" className={inputClass} />
                    </Field>
                    <Field label="License expires">
                      <input name="licenseExpires" type="date" required className={inputClass} />
                    </Field>
                    <Field label="Address (optional)">
                      <input name="address" className={inputClass} />
                    </Field>
                    <Field label="Contact (optional)">
                      <input name="contactName" className={inputClass} />
                    </Field>
                    <Field label="Phone (optional)">
                      <input name="phone" className={inputClass} />
                    </Field>
                    <Field label="Email (optional)">
                      <input name="email" type="email" className={inputClass} />
                    </Field>
                  </ActionForm>
                </Disclosure>
              </div>
            ) : null}
          </Card>

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
                      {order.destination ? `${order.destination} · ` : ""}
                      {order.createdAt.toLocaleDateString("en-US")} <Pill status={order.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Vendor details">
            {canWrite ? (
              <ActionForm action={vendorDetailsAction} submitLabel="Save details">
                <input type="hidden" name="vendorId" value={vendor.id} />
                <fieldset className="space-y-2 text-sm">
                  <legend className="mb-1 font-medium text-slate-700">This vendor is one</legend>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="weSellTo" defaultChecked={vendor.weSellTo} className="h-5 w-5 accent-brand-700" /> we sell to
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="weBuyFrom" defaultChecked={vendor.weBuyFrom} className="h-5 w-5 accent-brand-700" /> we buy from
                  </label>
                </fieldset>
                <Field label="Payment terms in days" hint="0 means payment on delivery.">
                  <input name="paymentTermsDays" inputMode="numeric" defaultValue={vendor.paymentTermsDays} className={inputClass} />
                </Field>
                <Field label="Contact">
                  <input name="contactName" defaultValue={vendor.contactName ?? ""} className={inputClass} />
                </Field>
                <Field label="Email">
                  <input name="email" type="email" defaultValue={vendor.email ?? ""} className={inputClass} />
                </Field>
                <Field label="Phone">
                  <input name="phone" defaultValue={vendor.phone ?? ""} className={inputClass} />
                </Field>
                <Field label="Address">
                  <input name="address" defaultValue={vendor.address ?? ""} className={inputClass} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={vendor.active} className="h-5 w-5 accent-brand-700" /> Active
                </label>
              </ActionForm>
            ) : (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-slate-600">Payment terms</dt>
                <dd className="text-right">{vendor.paymentTermsDays === 0 ? "on delivery" : `net ${vendor.paymentTermsDays} days`}</dd>
                <dt className="text-slate-600">Contact</dt>
                <dd className="text-right">{vendor.contactName ?? "none"}</dd>
                <dt className="text-slate-600">Email</dt>
                <dd className="break-all text-right">{vendor.email ?? "none"}</dd>
                <dt className="text-slate-600">Phone</dt>
                <dd className="text-right">{vendor.phone ?? "none"}</dd>
              </dl>
            )}
          </Card>
          {canWrite ? (
            <Card title="Price list">
              <ActionForm action={customerPriceListAction} submitLabel="Save price list">
                <input type="hidden" name="customerId" value={vendor.id} />
                <Field label="This vendor pays" hint="Items missing from their list use the default list.">
                  <select name="priceListId" defaultValue={vendor.priceListId ?? ""} className={inputClass}>
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
          ) : null}
        </div>
      </div>
    </>
  );
}
