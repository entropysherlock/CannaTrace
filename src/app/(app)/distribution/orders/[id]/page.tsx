import { TriangleAlert } from "lucide-react";
import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { LabelLink } from "@/components/labels/label-link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { DistributionTabs, Pill, unitPrice, usd } from "@/components/distribution-ui";
import { ScanInput } from "@/components/scan-input";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, destinations, drivers, invoices, items, orderAllocations, orderLines, orders, packages, vehicles } from "@/db/schema";
import { db } from "@/lib/db";
import { licenseProblem, lineTotal, todayIn } from "@/lib/distribution-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import {
  allocateAction,
  deliverAction,
  lineAction,
  orderStepAction,
  removeLineAction,
  shipAction,
  unallocateAction,
} from "../../actions";

const NEXT_STEP: Record<string, string> = {
  DRAFT: "Add the lines, then confirm the order.",
  CONFIRMED: "Pick packages for each line, then mark the order packed.",
  PACKED: "Choose a driver and vehicle, then ship.",
  SHIPPED: "On the road. Mark it delivered when the customer signs for it.",
  DELIVERED: "Delivered. Record payments on the invoice.",
  CANCELLED: "Cancelled. Any picked packages went back to stock.",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("sales.view");
  const { id } = await params;
  const [row] = await db
    .select({ order: orders, customer: customers, destination: destinations })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(destinations, eq(destinations.id, orders.destinationId))
    .where(and(eq(orders.id, id), eq(orders.orgId, session.orgId), eq(orders.facilityId, session.facilityId)));
  if (!row) notFound();
  const { order, customer } = row;

  const [lines, allocations, itemRows, driverRows, vehicleRows, [invoice]] = await Promise.all([
    db
      .select({ id: orderLines.id, quantity: orderLines.quantity, unitPrice: orderLines.unitPrice, itemName: items.name, unit: items.unit })
      .from(orderLines)
      .innerJoin(items, eq(items.id, orderLines.itemId))
      .where(eq(orderLines.orderId, order.id))
      .orderBy(asc(items.name)),
    db
      .select({ id: orderAllocations.id, lineId: orderAllocations.orderLineId, quantity: orderAllocations.quantity, packageId: packages.id, tag: packages.tag })
      .from(orderAllocations)
      .innerJoin(packages, eq(packages.id, orderAllocations.packageId))
      .where(eq(orderAllocations.orderId, order.id))
      .orderBy(asc(packages.tag)),
    db
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(and(eq(items.orgId, session.orgId), eq(items.active, true)))
      .orderBy(asc(items.name)),
    db.select().from(drivers).where(and(eq(drivers.orgId, session.orgId), eq(drivers.active, true))).orderBy(asc(drivers.name)),
    db.select().from(vehicles).where(and(eq(vehicles.orgId, session.orgId), eq(vehicles.active, true))).orderBy(asc(vehicles.plate)),
    db.select({ id: invoices.id, number: invoices.number }).from(invoices).where(eq(invoices.orderId, order.id)),
  ]);

  const canSell = can(session, "sales.write");
  const canFulfil = canSell || can(session, "inventory.write");
  // The destination's license is the one checked when the order ships.
  const problem = row.destination ? licenseProblem({ ...row.destination, name: `${customer.name} (${row.destination.name})` }, todayIn()) : licenseProblem(customer, todayIn());
  const hidden = <input type="hidden" name="orderId" value={order.id} />;
  const pickedFor = (lineId: string) =>
    allocations.filter((a) => a.lineId === lineId).reduce((sum, a) => sum.add(a.quantity), new Decimal(0));
  const orderedTotal = lines.reduce((sum, l) => sum.add(lineTotal(l.quantity, l.unitPrice)), new Decimal(0));
  const pickedTotal = lines.reduce((sum, l) => sum.add(lineTotal(pickedFor(l.id), l.unitPrice)), new Decimal(0));
  const shortLines = lines.filter((l) => pickedFor(l.id).lt(l.quantity));
  const num = (value: Decimal.Value) => new Decimal(value).toString();
  const step = (name: string, label: string) => (
    <ActionForm action={orderStepAction} submitLabel={label} quiet={name === "cancel" || name === "reopen"}>
      {hidden}
      <input type="hidden" name="step" value={name} />
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title={order.number}
        subtitle={`${customer.name}${row.destination && row.destination.name !== customer.name ? ` – ${row.destination.name}` : ""} · started by ${order.userName} on ${order.createdAt.toLocaleDateString("en-US")}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {allocations.length && can(session, "labels.print") && !["DRAFT", "CANCELLED"].includes(order.status) ? (
              <LabelLink kind="TRANSFER" ids={[order.id]}>
                Print transfer labels
              </LabelLink>
            ) : null}
            <Pill status={order.status} />
          </div>
        }
      />
      <DistributionTabs current="/distribution" />
      <p className="mb-5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800">{NEXT_STEP[order.status]}</p>
      {problem && !["SHIPPED", "DELIVERED", "CANCELLED"].includes(order.status) ? (
        <p className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {problem}{" "}
          <Link href={`/distribution/customers/${customer.id}`} className="underline">
            Open vendor
          </Link>
        </p>
      ) : null}
      {order.notes ? <p className="mb-5 text-sm text-slate-700">Note: {order.notes}</p> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card
            title="Lines"
            action={
              <span className="text-sm text-slate-600">
                ordered {usd(orderedTotal)}
                {order.status !== "DRAFT" ? ` · picked ${usd(pickedTotal)}` : ""}
              </span>
            }
          >
            {lines.length === 0 ? (
              <p className="text-sm text-slate-600">No lines yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {lines.map((line) => {
                  const picked = pickedFor(line.id);
                  const done = picked.gte(line.quantity);
                  return (
                    <li key={line.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{line.itemName}</p>
                          <p className="text-slate-600">
                            {num(line.quantity)} {unitLabel(line.unit)} at {unitPrice(line.unitPrice)} = {usd(lineTotal(line.quantity, line.unitPrice))}
                          </p>
                        </div>
                        {order.status === "DRAFT" && canSell ? (
                          <ActionForm action={removeLineAction} submitLabel="Remove" quiet className="flex flex-col items-end gap-1">
                            <input type="hidden" name="lineId" value={line.id} />
                          </ActionForm>
                        ) : order.status !== "DRAFT" ? (
                          <span className={`font-semibold ${done ? "text-brand-700" : "text-amber-700"}`}>
                            picked {num(picked)} of {num(line.quantity)}
                          </span>
                        ) : null}
                      </div>
                      {allocations
                        .filter((a) => a.lineId === line.id)
                        .map((allocation) => (
                          <div key={allocation.id} className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                            <span>
                              <Link href={`/inventory/${allocation.packageId}`} className="font-mono font-semibold text-brand-700 hover:underline">
                                {allocation.tag}
                              </Link>{" "}
                              <span className="text-slate-600">
                                · {num(allocation.quantity)} {unitLabel(line.unit)}
                              </span>
                            </span>
                            {order.status === "CONFIRMED" && canFulfil ? (
                              <ActionForm action={unallocateAction} submitLabel="Take off order" quiet className="flex flex-col items-end gap-1">
                                <input type="hidden" name="allocationId" value={allocation.id} />
                              </ActionForm>
                            ) : null}
                          </div>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {order.manifestNumber ? (
            <Card title="Shipment">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-slate-600">Manifest</dt>
                <dd className="text-right">
                  <Link href={`/distribution/orders/${order.id}/manifest`} className="font-semibold text-brand-700 hover:underline">
                    {order.manifestNumber} (print)
                  </Link>
                </dd>
                <dt className="text-slate-600">Invoice</dt>
                <dd className="text-right">
                  {invoice ? (
                    <Link href={`/distribution/orders/${order.id}/invoice`} className="font-semibold text-brand-700 hover:underline">
                      {invoice.number} (view and record payments)
                    </Link>
                  ) : (
                    "none"
                  )}
                </dd>
                <dt className="text-slate-600">Departed</dt>
                <dd className="text-right">{order.departAt?.replace("T", " at ")}</dd>
                <dt className="text-slate-600">Delivered</dt>
                <dd className="text-right">
                  {order.deliveredAt ? `${order.deliveredAt.toLocaleString("en-US")}, received by ${order.receivedBy}` : "not yet"}
                </dd>
              </dl>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {order.status === "DRAFT" && canSell ? (
            <>
              <Card title="Add a line">
                <ActionForm action={lineAction} submitLabel="Add line">
                  {hidden}
                  <Field label="Item">
                    <select name="itemId" required defaultValue="" className={inputClass}>
                      <option value="" disabled>
                        Choose an item
                      </option>
                      {itemRows.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({unitLabel(item.unit)})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity">
                    <input name="quantity" inputMode="decimal" required className={inputClass} />
                  </Field>
                  <Field label="Price per unit (optional)" hint="Leave empty to use this customer's price list.">
                    <input name="unitPrice" inputMode="decimal" className={inputClass} />
                  </Field>
                </ActionForm>
              </Card>
              <Card title="Confirm the order">{step("confirm", "Confirm order")}</Card>
            </>
          ) : null}

          {order.status === "CONFIRMED" && canFulfil ? (
            <>
              <Card title="Pick a package">
                <ActionForm action={allocateAction} submitLabel="Pick">
                  {hidden}
                  <Field label="For line">
                    <select name="lineId" required defaultValue={shortLines[0]?.id ?? ""} className={inputClass}>
                      {lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.itemName} (needs {num(Decimal.max(0, new Decimal(line.quantity).sub(pickedFor(line.id))))} more)
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Package tag">
                    <ScanInput name="tag" required />
                  </Field>
                  <Field label="Quantity (optional)" hint="Leave empty to take the whole package.">
                    <input name="quantity" inputMode="decimal" className={inputClass} />
                  </Field>
                  <Field label="New tag (only when taking part of a package)" hint="The picked part becomes its own package with this tag.">
                    <input name="newTag" autoCapitalize="characters" className={`${inputClass} font-mono`} />
                  </Field>
                </ActionForm>
              </Card>
              <Card title="Mark packed">
                {shortLines.length && allocations.length ? (
                  <p className="mb-3 text-sm text-amber-800">
                    {shortLines.length} line{shortLines.length === 1 ? " is" : "s are"} not fully picked. Packing now ships short, and the invoice will only bill what
                    ships.
                  </p>
                ) : null}
                {step("pack", "Mark packed")}
              </Card>
            </>
          ) : null}

          {order.status === "PACKED" && canFulfil ? (
            <>
              <Card title="Ship">
                {driverRows.length === 0 || vehicleRows.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    Add a driver and a vehicle first on the{" "}
                    <Link href="/distribution/fleet" className="font-semibold text-brand-700 hover:underline">
                      Drivers and vehicles
                    </Link>{" "}
                    tab.
                  </p>
                ) : (
                  <ActionForm action={shipAction} submitLabel="Ship order">
                    {hidden}
                    <Field label="Driver">
                      <select name="driverId" required defaultValue="" className={inputClass}>
                        <option value="" disabled>
                          Choose a driver
                        </option>
                        {driverRows.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Vehicle">
                      <select name="vehicleId" required defaultValue="" className={inputClass}>
                        <option value="" disabled>
                          Choose a vehicle
                        </option>
                        {vehicleRows.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.make} {v.model} · {v.plate}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Departure date and time">
                      <input name="departAt" type="datetime-local" required className={inputClass} />
                    </Field>
                    <Field label="Route notes (optional)">
                      <input name="routeNotes" maxLength={500} className={inputClass} />
                    </Field>
                    <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-900"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Shipping removes the packages from inventory and creates the invoice. It cannot be undone.</span></p>
                  </ActionForm>
                )}
              </Card>
              <Card title="Reopen for changes">{step("reopen", "Reopen order")}</Card>
            </>
          ) : null}

          {order.status === "SHIPPED" && canFulfil ? (
            <Card title="Mark delivered">
              <ActionForm action={deliverAction} submitLabel="Mark delivered">
                {hidden}
                <Field label="Received by">
                  <input name="receivedBy" required maxLength={100} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}

          {["DRAFT", "CONFIRMED", "PACKED"].includes(order.status) && canSell ? (
            <Card title="Cancel the order">
              <p className="mb-3 text-sm text-slate-600">Any picked packages go back to active stock.</p>
              {step("cancel", "Cancel order")}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
