import { and, asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect } from "@/components/contextual-create";
import { Pill, usd } from "@/components/distribution-ui";
import { addVendorConfig } from "@/components/vendor-drawer";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { customers, purchaseOrderLines, purchaseOrders } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { createPoAction, importPoAction } from "./actions";

export const metadata = { title: "Purchase orders · Leaf2Sale" };

const TEMPLATE = "sku,item,quantity,unit cost\nBM-35,,100,12.50\n,Desert Haze 1 g Pre-roll,250,3.25\n";

export default async function PurchaseOrdersPage() {
  const session = await requirePagePermission("inventory.write");
  const zone = await facilityZone(session.facilityId);
  const [rows, vendors] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        expectedOn: purchaseOrders.expectedOn,
        createdAt: purchaseOrders.createdAt,
        vendor: customers.name,
        lines: sql<number>`(select count(*)::int from ${purchaseOrderLines} where ${purchaseOrderLines.purchaseOrderId} = ${purchaseOrders.id})`,
        total: sql<string>`coalesce((select sum(round(${purchaseOrderLines.quantity} * coalesce(${purchaseOrderLines.unitCost}, 0), 2)) from ${purchaseOrderLines} where ${purchaseOrderLines.purchaseOrderId} = ${purchaseOrders.id}), 0)`,
        due: sql<string>`coalesce((select sum(greatest(${purchaseOrderLines.quantity} - ${purchaseOrderLines.quantityReceived}, 0)) from ${purchaseOrderLines} where ${purchaseOrderLines.purchaseOrderId} = ${purchaseOrders.id}), 0)`,
      })
      .from(purchaseOrders)
      .innerJoin(customers, eq(customers.id, purchaseOrders.vendorId))
      .where(and(eq(purchaseOrders.orgId, session.orgId), eq(purchaseOrders.facilityId, session.facilityId)))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(200),
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.orgId, session.orgId), eq(customers.active, true), eq(customers.weBuyFrom, true)))
      .orderBy(asc(customers.name)),
  ]);
  const canAddVendor = can(session, "sales.write");
  const open = rows.filter((r) => ["DRAFT", "SENT", "PARTIAL"].includes(r.status));
  const closed = rows.filter((r) => !["DRAFT", "SENT", "PARTIAL"].includes(r.status));
  const vendorSelect = (
    <CreatableSelect
      name="vendorId"
      searchable
      label="Vendor"
      required
      placeholder="Who you are buying from"
      options={vendors.map((v) => ({ id: v.id, label: v.name }))}
      create={canAddVendor ? addVendorConfig : undefined}
      deniedHint="Vendor missing? Someone in sales can add it under Distribution → Vendors."
    />
  );

  const table = (list: typeof rows) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-3">PO</th>
            <th className="py-2 pr-3">Vendor</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Expected</th>
            <th className="py-2 pr-3 text-right">Lines</th>
            <th className="py-2 pr-3 text-right">Still due</th>
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((r) => (
            <tr key={r.id}>
              <td className="py-2 pr-3 font-semibold">
                <Link href={`/purchasing/${r.id}`} className="text-brand-700 hover:underline">
                  {r.number}
                </Link>
              </td>
              <td className="py-2 pr-3">{r.vendor}</td>
              <td className="py-2 pr-3">
                <Pill status={r.status} />
              </td>
              <td className="py-2 pr-3">{r.expectedOn ?? "—"}</td>
              <td className="py-2 pr-3 text-right">{r.lines}</td>
              <td className="py-2 pr-3 text-right">{Number(r.due).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
              <td className="py-2 text-right">{usd(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader title="Purchase orders" subtitle="Order from your vendors, then receive against the PO when it arrives: all at once, or a line at a time." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={`Open (${open.length})`}>
            {open.length ? table(open) : <p className="text-sm text-slate-600">No open purchase orders. Start one on the right, or import one from a spreadsheet.</p>}
          </Card>
          {closed.length ? <Card title="Received and cancelled">{table(closed)}</Card> : null}
          <p className="text-xs text-slate-500">Times shown in {zone}.</p>
        </div>
        <div className="space-y-5">
          <Card title="New purchase order">
            <ActionForm action={createPoAction} submitLabel="Start purchase order">
              {vendorSelect}
              <Field label="Expected (optional)" hint="When the vendor says it will arrive.">
                <input name="expectedOn" type="date" className={inputClass} />
              </Field>
              <Field label="Notes (optional)">
                <input name="notes" maxLength={500} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
          <Card title="Import a purchase order">
            <ActionForm action={importPoAction} submitLabel="Import">
              <p className="text-sm text-slate-600">
                A CSV with one row per product: <strong>sku</strong> or <strong>item</strong> (exact name), <strong>quantity</strong>, and an optional <strong>unit cost</strong>. Every row is checked first; if one
                is wrong, nothing is saved and you&apos;re told which row.{" "}
                <a download="purchase-order-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} className="font-semibold text-brand-700 underline">
                  Download the template
                </a>
                .
              </p>
              {vendorSelect}
              <Field label="CSV file">
                <input name="file" type="file" accept=".csv,text/csv" required className="block w-full text-sm" />
              </Field>
              <Field label="Expected (optional)">
                <input name="expectedOn" type="date" className={inputClass} />
              </Field>
              <Field label="Notes (optional)">
                <input name="notes" maxLength={500} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
