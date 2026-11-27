import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect } from "@/components/contextual-create";
import { Pill, unitPrice, usd } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, items, locations, packages, purchaseOrderLines, purchaseOrderReceipts, purchaseOrders } from "@/db/schema";
import { db } from "@/lib/db";
import { editable, poTotal, receivable, remaining } from "@/lib/purchasing-math";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { unitLabel } from "@/lib/units";
import { addPoLineAction, poStepAction, receivePoAction, receiveWholePoAction, removePoLineAction } from "../actions";

export const metadata = { title: "Purchase order · Leaf2Sale" };

const NEXT: Record<string, string> = {
  DRAFT: "Add the lines, then mark it sent once the vendor has it. You can also receive straight from a draft.",
  SENT: "Waiting on the vendor. When it arrives, receive it below: everything at once, or line by line.",
  PARTIAL: "Part of it is in. Receive the rest when it arrives, or close it short if nothing more is coming.",
  RECEIVED: "Everything is in. The packages are in inventory.",
  CANCELLED: "Cancelled. Nothing was received.",
};

const n = (v: Decimal.Value) => new Decimal(v).toNumber().toLocaleString("en-US", { maximumFractionDigits: 4 });

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("inventory.write");
  const { id } = await params;
  const [row] = await db
    .select({ po: purchaseOrders, vendor: customers.name, vendorLicense: customers.licenseNumber })
    .from(purchaseOrders)
    .innerJoin(customers, eq(customers.id, purchaseOrders.vendorId))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.orgId, session.orgId), eq(purchaseOrders.facilityId, session.facilityId)));
  if (!row) notFound();
  const { po } = row;
  const zone = await facilityZone(session.facilityId);
  const [lines, receipts, itemRows, locationRows] = await Promise.all([
    db
      .select({ line: purchaseOrderLines, item: items.name, sku: items.sku, unit: items.unit })
      .from(purchaseOrderLines)
      .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
      .where(eq(purchaseOrderLines.purchaseOrderId, po.id))
      .orderBy(asc(items.name)),
    db
      .select({ id: packages.id, tag: packages.tag, item: items.name, quantity: purchaseOrderReceipts.quantity, unit: packages.unit, by: purchaseOrderReceipts.userName, at: purchaseOrderReceipts.createdAt })
      .from(purchaseOrderReceipts)
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, purchaseOrderReceipts.purchaseOrderLineId))
      .innerJoin(packages, eq(packages.id, purchaseOrderReceipts.packageId))
      .innerJoin(items, eq(items.id, packages.itemId))
      .where(eq(purchaseOrderLines.purchaseOrderId, po.id))
      .orderBy(asc(purchaseOrderReceipts.createdAt)),
    editable(po.status)
      ? db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(and(eq(items.orgId, session.orgId), eq(items.active, true))).orderBy(asc(items.name))
      : Promise.resolve([]),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
      .orderBy(asc(locations.name)),
  ]);
  const hidden = <input type="hidden" name="purchaseOrderId" value={po.id} />;
  const due = lines.filter((l) => remaining(l.line).gt(0));
  const canReceive = receivable(po.status) && due.length > 0;
  const total = poTotal(lines.map((l) => l.line));
  const locationSelect = (
    <CreatableSelect name="locationId" label="Put away to" required placeholder="Choose a location" options={locationRows.map((l) => ({ id: l.id, label: l.name }))} />
  );
  const step = (s: string, label: string) => (
    <ActionForm action={poStepAction} submitLabel={label}>
      {hidden}
      <input type="hidden" name="step" value={s} />
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title={`${po.number} · ${row.vendor}`}
        subtitle={NEXT[po.status]}
        action={
          <Link href="/purchasing" className="text-sm font-semibold text-brand-700 hover:underline">
            All purchase orders
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={<span className="flex items-center gap-2">Lines <Pill status={po.status} /></span>}>
            {lines.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Item</th>
                      <th className="py-2 pr-3 text-right">Ordered</th>
                      <th className="py-2 pr-3 text-right">Received</th>
                      <th className="py-2 pr-3 text-right">Still due</th>
                      <th className="py-2 pr-3 text-right">Unit cost</th>
                      <th className="py-2 text-right">Line total</th>
                      {editable(po.status) ? <th className="py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map(({ line, item, sku, unit }) => (
                      <tr key={line.id}>
                        <td className="py-2 pr-3">
                          <span className="font-medium text-slate-900">{item}</span> <span className="text-xs text-slate-500">{sku}</span>
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {n(line.quantity)} {unitLabel(unit)}
                        </td>
                        <td className="py-2 pr-3 text-right">{n(line.quantityReceived)}</td>
                        <td className="py-2 pr-3 text-right font-semibold">{n(remaining(line))}</td>
                        <td className="py-2 pr-3 text-right">{line.unitCost ? unitPrice(line.unitCost) : "—"}</td>
                        <td className="py-2 text-right">{line.unitCost ? usd(new Decimal(line.quantity).mul(line.unitCost).toDecimalPlaces(2)) : "—"}</td>
                        {editable(po.status) ? (
                          <td className="py-2 pl-2 text-right">
                            <ActionForm action={removePoLineAction} submitLabel="Remove">
                              <input type="hidden" name="lineId" value={line.id} />
                            </ActionForm>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="pt-3 text-right font-semibold">
                        Total
                      </td>
                      <td className="pt-3 text-right font-bold">{usd(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No lines yet. Add what you are ordering on the right.</p>
            )}
          </Card>

          {canReceive ? (
            <Card title="Receive what arrived">
              <ActionForm action={receivePoAction} submitLabel="Receive these">
                {hidden}
                <p className="text-sm text-slate-600">
                  Each line becomes one new package with the vendor and the line&apos;s cost. Counts start at what is still due; change any that came in short, or set 0 to skip a line. Leave the tag blank to
                  generate one, or scan the state tag.
                </p>
                {locationSelect}
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {due.map(({ line, item, unit }) => (
                    <div key={line.id} className="grid gap-2 p-2 sm:grid-cols-[1fr_7rem_10rem_8rem] sm:items-end">
                      <input type="hidden" name="lineId" value={line.id} />
                      <p className="text-sm font-medium text-slate-900">
                        {item} <span className="text-xs text-slate-500">({n(remaining(line))} {unitLabel(unit)} due)</span>
                      </p>
                      <label className="text-xs text-slate-600">
                        Arrived
                        <input name={`qty:${line.id}`} inputMode="decimal" defaultValue={remaining(line).toString()} aria-label={`How much ${item} arrived`} className={inputClass} />
                      </label>
                      <label className="text-xs text-slate-600">
                        Tag
                        <input name={`tag:${line.id}`} placeholder="Blank = new" aria-label={`Tag for ${item}`} className={inputClass} />
                      </label>
                      <label className="text-xs text-slate-600">
                        Lot
                        <input name={`lot:${line.id}`} aria-label={`Lot for ${item}`} className={inputClass} />
                      </label>
                    </div>
                  ))}
                </div>
                <Field label="Note (optional)">
                  <input name="note" maxLength={300} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}

          {receipts.length ? (
            <Card title={`Received (${receipts.length} package${receipts.length === 1 ? "" : "s"})`}>
              <ul className="divide-y divide-slate-100 text-sm">
                {receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      <Link href={`/inventory/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                        {r.tag}
                      </Link>{" "}
                      · {r.item} · {n(r.quantity)} {unitLabel(r.unit)}
                    </span>
                    <span className="text-slate-500">
                      {r.by}, {r.at.toLocaleString("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-slate-500">Vendor</dt>
              <dd className="text-right">{row.vendor}</dd>
              <dt className="text-slate-500">License</dt>
              <dd className="text-right">{row.vendorLicense}</dd>
              <dt className="text-slate-500">Expected</dt>
              <dd className="text-right">{po.expectedOn ?? "not set"}</dd>
              <dt className="text-slate-500">Started</dt>
              <dd className="text-right">
                {po.createdAt.toLocaleDateString("en-US", { timeZone: zone })} by {po.userName}
              </dd>
              <dt className="text-slate-500">Sent</dt>
              <dd className="text-right">{po.sentAt ? po.sentAt.toLocaleDateString("en-US", { timeZone: zone }) : "not yet"}</dd>
            </dl>
            {po.notes ? <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{po.notes}</p> : null}
          </Card>

          {canReceive ? (
            <Card title="Receive the whole PO">
              <ActionForm action={receiveWholePoAction} submitLabel="Receive everything">
                {hidden}
                <p className="text-sm text-slate-600">One click: everything still due comes in, one package per line with new tags, at the line&apos;s cost.</p>
                {locationSelect}
              </ActionForm>
            </Card>
          ) : null}

          {editable(po.status) ? (
            <Card title="Add a line">
              <ActionForm action={addPoLineAction} submitLabel="Add line">
                {hidden}
                <CreatableSelect name="itemId" searchable label="Item" required placeholder="Choose an item" options={itemRows.map((i) => ({ id: i.id, label: `${i.name} (${unitLabel(i.unit)})` }))} />
                <Field label="Quantity ordered">
                  <input name="quantity" inputMode="decimal" required className={inputClass} />
                </Field>
                <Field label="Cost per unit (optional)" hint="Received packages carry this as their cost.">
                  <input name="unitCost" inputMode="decimal" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}

          {po.status === "DRAFT" && lines.length ? <Card title="Sent it to the vendor?">{step("send", "Mark sent")}</Card> : null}
          {po.status === "PARTIAL" ? (
            <Card title="Nothing more coming?">
              <p className="mb-2 text-sm text-slate-600">Closes the PO with what arrived. What&apos;s still due is dropped.</p>
              {step("close", "Close short")}
            </Card>
          ) : null}
          {editable(po.status) ? (
            <Card title="Cancel">
              <p className="mb-2 text-sm text-slate-600">Only while nothing has been received.</p>
              {step("cancel", "Cancel this purchase order")}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
