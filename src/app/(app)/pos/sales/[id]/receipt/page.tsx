import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Pill, unitPrice, usd } from "@/components/distribution-ui";
import { PrintButton } from "@/components/print-button";
import { Card, Field, inputClass } from "@/components/ui";
import { drawerSessions, facilities, items, packages, saleLinePackages, saleLines, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { voidSaleAction } from "../../../actions";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("pos.use");
  const { id } = await params;
  const [row] = await db
    .select({ sale: sales, facility: facilities, drawerStatus: drawerSessions.status })
    .from(sales)
    .innerJoin(facilities, eq(facilities.id, sales.facilityId))
    .innerJoin(drawerSessions, eq(drawerSessions.id, sales.drawerSessionId))
    .where(and(eq(sales.id, id), eq(sales.orgId, session.orgId), eq(sales.facilityId, session.facilityId)));
  if (!row) notFound();
  const { sale, facility } = row;
  if (sale.status === "OPEN") redirect(`/pos/sales/${sale.id}`);

  const [lines, tags] = await Promise.all([
    db
      .select({ id: saleLines.id, itemName: items.name, quantity: saleLines.quantity, unitPrice: saleLines.unitPrice })
      .from(saleLines)
      .innerJoin(items, eq(items.id, saleLines.itemId))
      .where(eq(saleLines.saleId, sale.id))
      .orderBy(asc(items.name)),
    db
      .select({ lineId: saleLinePackages.saleLineId, tag: packages.tag })
      .from(saleLinePackages)
      .innerJoin(packages, eq(packages.id, saleLinePackages.packageId))
      .innerJoin(saleLines, eq(saleLines.id, saleLinePackages.saleLineId))
      .where(eq(saleLines.saleId, sale.id))
      .orderBy(asc(packages.tag)),
  ]);
  const canVoid = sale.status === "COMPLETED" && row.drawerStatus === "OPEN" && can(session, "pos.manage");

  return (
    <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-5">
      <div className="md:col-span-3">
        <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
          <Link href="/pos" className="text-sm font-semibold text-brand-700 hover:underline">
            Back to register
          </Link>
          {sale.status === "COMPLETED" ? <PrintButton label="Print receipt" /> : null}
        </div>
        <div className="bg-white p-5 text-sm text-slate-900 shadow-sm print:p-0 print:shadow-none">
          <div className="text-center">
            <p className="text-base font-bold">{facility.name}</p>
            <p>License {facility.licenseNumber}</p>
            <p className="mt-2">
              Sale {sale.number} · {(sale.completedAt ?? sale.createdAt).toLocaleString("en-US")}
            </p>
            <p>Served by {sale.userName.split(" ")[0]}</p>
            {sale.status !== "COMPLETED" ? (
              <p className="mt-2">
                <Pill status={sale.status} />
              </p>
            ) : null}
          </div>
          {sale.status === "CANCELLED" ? (
            <p className="mt-4 text-center text-slate-600">This cart was cancelled before payment. Nothing was sold.</p>
          ) : (
            <>
              <ul className="mt-4 divide-y divide-dashed divide-slate-300 border-y border-dashed border-slate-400">
                {lines.map((line) => (
                  <li key={line.id} className="py-2">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{line.itemName}</span>
                      <span>{usd(new Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2))}</span>
                    </div>
                    <p className="text-slate-600">
                      {new Decimal(line.quantity).toString()} × {unitPrice(line.unitPrice)}
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      {tags
                        .filter((t) => t.lineId === line.id)
                        .map((t) => t.tag)
                        .join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 grid grid-cols-2 gap-y-1">
                <dt>Subtotal</dt>
                <dd className="text-right">{usd(sale.subtotal ?? 0)}</dd>
                {new Decimal(sale.discountTotal ?? 0).gt(0) ? (
                  <>
                    <dt>Discount ({sale.discountName})</dt>
                    <dd className="text-right">-{usd(sale.discountTotal ?? 0)}</dd>
                  </>
                ) : null}
                <dt>Cannabis excise tax</dt>
                <dd className="text-right">{usd(sale.exciseTax ?? 0)}</dd>
                <dt>Sales tax</dt>
                <dd className="text-right">{usd(sale.salesTax ?? 0)}</dd>
                <dt className="border-t border-slate-400 pt-1 text-base font-bold">Total</dt>
                <dd className="border-t border-slate-400 pt-1 text-right text-base font-bold">{usd(sale.total ?? 0)}</dd>
                <dt>Paid by {sale.paymentMethod?.toLowerCase()}</dt>
                <dd className="text-right">{usd(sale.cashTendered ?? sale.total ?? 0)}</dd>
                {sale.paymentMethod === "CASH" ? (
                  <>
                    <dt className="font-semibold">Change</dt>
                    <dd className="text-right font-semibold">{usd(sale.changeDue ?? 0)}</dd>
                  </>
                ) : null}
              </dl>
              {sale.status === "VOIDED" ? <p className="mt-4 font-semibold text-red-700">Voided: {sale.voidReason}</p> : null}
            </>
          )}
        </div>
      </div>

      {canVoid ? (
        <div className="md:col-span-2 print:hidden">
          <Card title="Void this sale">
            <ActionForm action={voidSaleAction} submitLabel="Void sale" quiet>
              <input type="hidden" name="saleId" value={sale.id} />
              <p className="text-sm text-slate-600">
                Puts the product back into the packages it came from and removes the sale from today&apos;s totals. Refund the customer by hand.
              </p>
              <Field label="Reason" hint="Required. Shown in the audit trail.">
                <input name="reason" required maxLength={300} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
