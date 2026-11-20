import { TriangleAlert } from "lucide-react";
import Decimal from "decimal.js";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import Link from "next/link";
import { LabelLink } from "@/components/labels/label-link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect } from "@/components/contextual-create";
import { ItemFields } from "@/components/item-fields";
import { DriverFields, VehicleFields } from "@/components/quick-fields";
import { DistributionTabs, OrderProgress, PickBar, unitPrice, usd } from "@/components/distribution-ui";
import { OrderPickFields } from "@/components/order-pick-fields";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, destinations, drivers, invoices, items, orderAllocations, orderLines, orders, packages, vehicles } from "@/db/schema";
import { db } from "@/lib/db";
import { licenseProblem, lineTotal } from "@/lib/distribution-math";
import { can } from "@/lib/rbac";
import { itemCategoryNames } from "@/lib/quick-create-data";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { facilityToday } from "@/lib/time";
import { facilityZone } from "@/lib/time";
import {
  allocateAction,
  autoPickAction,
  deliverAction,
  lineAction,
  orderStepAction,
  removeLineAction,
  shipAction,
  unallocateAction,
} from "../../actions";
import { quickDriverAction, quickItemAction, quickVehicleAction } from "../../../quick-create-actions";

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
  const zone = await facilityZone(session.facilityId);
  const today = await facilityToday(session.facilityId);
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
      .select({ id: orderLines.id, itemId: orderLines.itemId, quantity: orderLines.quantity, unitPrice: orderLines.unitPrice, itemName: items.name, unit: items.unit })
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
  const canManageCatalog = can(session, "catalog.manage");
  const categories = canManageCatalog && order.status === "DRAFT" ? await itemCategoryNames(session.orgId) : [];
  // The destination's license is the one checked when the order ships.
  const problem = row.destination ? licenseProblem({ ...row.destination, name: `${customer.name} (${row.destination.name})` }, today) : licenseProblem(customer, today);
  const hidden = <input type="hidden" name="orderId" value={order.id} />;
  // The packages that could be picked for this order's lines, so nobody has to know a tag.
  const pickable = order.status === "CONFIRMED" && lines.length
    ? await db
        .select({ tag: packages.tag, itemId: packages.itemId, quantity: packages.quantity, unit: packages.unit, lot: packages.lotNumber })
        .from(packages)
        .where(and(eq(packages.orgId, session.orgId), eq(packages.facilityId, session.facilityId), eq(packages.status, "ACTIVE"), inArray(packages.itemId, lines.map((l) => l.itemId)), gt(packages.quantity, "0")))
        .orderBy(asc(packages.createdAt))
        .limit(400)
    : [];
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
        subtitle={`${customer.name}${row.destination && row.destination.name !== customer.name ? ` – ${row.destination.name}` : ""} · started by ${order.userName} on ${order.createdAt.toLocaleDateString("en-US", { timeZone: zone })}`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {allocations.length && can(session, "labels.print") && !["DRAFT", "CANCELLED"].includes(order.status) ? (
              <LabelLink kind="TRANSFER" ids={[order.id]}>
                Print transfer labels
              </LabelLink>
            ) : null}
          </div>
        }
      />
      <DistributionTabs current="/distribution" />
      <OrderProgress status={order.status} next={NEXT_STEP[order.status]} />
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
                          <span className="w-32 text-right">
                            <span className={`font-semibold ${done ? "text-brand-700" : "text-amber-700"}`}>
                              picked {num(picked)} of {num(line.quantity)}
                            </span>
                            <PickBar picked={picked.toNumber()} of={new Decimal(line.quantity).toNumber()} />
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
                  {order.deliveredAt ? `${order.deliveredAt.toLocaleString("en-US", { timeZone: zone })}, received by ${order.receivedBy}` : "not yet"}
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
                  <CreatableSelect
                    name="itemId"
                    label="Item"
                    required
                    placeholder="Choose an item"
                    options={itemRows.map((item) => ({ id: item.id, label: `${item.name} (${unitLabel(item.unit)})` }))}
                    create={
                      canManageCatalog
                        ? {
                            buttonLabel: "Add item",
                            title: "Add an item",
                            intro: "It goes into your catalog too, and is picked for this line. Set its price on the Prices tab, or type one below.",
                            submitLabel: "Save item",
                            action: quickItemAction,
                            fields: <ItemFields categories={categories} />,
                          }
                        : undefined
                    }
                    deniedHint="Item missing? Someone who manages the catalog can add it on the Items page."
                  />
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
              <Card title={shortLines.length ? "Pick packages" : "All picked"}>
                <ActionForm action={autoPickAction} submitLabel="Pick everything, oldest first" quiet={!shortLines.length}>
                  {hidden}
                  <p className="text-sm text-slate-600">
                    {shortLines.length
                      ? "Fills every open line from the oldest active packages, splitting off just what's needed. Held or failed stock is skipped."
                      : "Every line is picked. Mark the order packed when it's ready."}
                  </p>
                </ActionForm>
                {shortLines.length ? (
                <details className="group mt-4 border-t border-slate-100 pt-3">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm font-semibold text-brand-800">
                    Or scan one package
                    <span className="text-slate-400 transition group-open:rotate-90" aria-hidden="true">›</span>
                  </summary>
                  <div className="pt-3">
                    <ActionForm action={allocateAction} submitLabel="Pick">
                      {hidden}
                      <OrderPickFields
                        firstId={shortLines[0]?.id ?? lines[0]?.id ?? ""}
                        lines={lines.map((line) => ({ id: line.id, itemId: line.itemId, label: `${line.itemName} (needs ${num(Decimal.max(0, new Decimal(line.quantity).sub(pickedFor(line.id))))} more)` }))}
                        packages={pickable.map((p) => ({ itemId: p.itemId, tag: p.tag, label: `${p.tag} · ${num(p.quantity)} ${unitLabel(p.unit)}${p.lot ? ` · lot ${p.lot}` : ""}` }))}
                      />
                      <Field label="Quantity (optional)" hint="Leave empty to take the whole package.">
                        <input name="quantity" inputMode="decimal" className={inputClass} />
                      </Field>
                      <Field label="New tag (only when taking part of a package)" hint="The picked part becomes its own package with this tag. Leave blank to get a new unique ID (PKG-000123).">
                        <input name="newTag" autoCapitalize="characters" className={`${inputClass} font-mono`} />
                      </Field>
                    </ActionForm>
                  </div>
                </details>
                ) : null}
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
                <ActionForm action={shipAction} submitLabel="Ship order">
                  {hidden}
                  <CreatableSelect
                    name="driverId"
                    label="Driver"
                    required
                    placeholder="Choose a driver"
                    options={driverRows.map((d) => ({ id: d.id, label: d.name }))}
                    create={
                      canSell
                        ? {
                            buttonLabel: "Add driver",
                            title: "Add a driver",
                            intro: "Saved to Drivers and vehicles and picked for this shipment.",
                            submitLabel: "Save driver",
                            action: quickDriverAction,
                            fields: <DriverFields />,
                          }
                        : undefined
                    }
                    deniedHint="Driver missing? Someone in sales can add one under Drivers and vehicles."
                  />
                  <CreatableSelect
                    name="vehicleId"
                    label="Vehicle"
                    required
                    placeholder="Choose a vehicle"
                    options={vehicleRows.map((v) => ({ id: v.id, label: `${v.make} ${v.model} · ${v.plate}` }))}
                    create={
                      canSell
                        ? {
                            buttonLabel: "Add vehicle",
                            title: "Add a vehicle",
                            intro: "Saved to Drivers and vehicles and picked for this shipment.",
                            submitLabel: "Save vehicle",
                            action: quickVehicleAction,
                            fields: <VehicleFields />,
                          }
                        : undefined
                    }
                    deniedHint="Vehicle missing? Someone in sales can add one under Drivers and vehicles."
                  />
                  <Field label="Departure date and time">
                    <input name="departAt" type="datetime-local" required className={inputClass} />
                  </Field>
                  <Field label="Planned route" hint="Type the stops and roads in order. It prints on the manifest, so nobody has to write it by hand.">
                    <textarea name="routeNotes" rows={3} maxLength={500} placeholder="e.g. I-25 south to Albuquerque, then Central Ave to the store" className={inputClass} />
                  </Field>
                  <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-900"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Shipping removes the packages from inventory and creates the invoice. It cannot be undone.</span></p>
                </ActionForm>
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
            <section className="rounded-xl border border-dashed border-slate-300 px-4 py-4 sm:px-5">
              <h2 className="text-sm font-bold text-slate-700">Cancel the order</h2>
              <p className="mb-3 mt-1 text-sm text-slate-600">Any picked packages go back to active stock.</p>
              {step("cancel", "Cancel order")}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
