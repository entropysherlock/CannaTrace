import { Info } from "lucide-react";
import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { Fragment } from "react";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Pill, unitPrice, usd } from "@/components/distribution-ui";
import { PrintButton } from "@/components/print-button";
import { Card, Field, inputClass } from "@/components/ui";
import {
  drawerSessions,
  facilities,
  items,
  packages,
  saleLinePackages,
  saleLines,
  sales,
} from "@/db/schema";
import { db } from "@/lib/db";
import { getRetailSettings, happenedWithin, returnableLines, returnsForSale } from "@/lib/pos";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { NextCustomer } from "@/components/register/next-customer";
import { RegisterShell } from "@/components/register/shell";
import { returnSaleAction, voidSaleAction } from "../../../actions";
import { shellInfo } from "../../../shell-info";
import { facilityZone } from "@/lib/time";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("pos.use");
  const zone = await facilityZone(session.facilityId);
  const { id } = await params;
  const [row] = await db
    .select({
      sale: sales,
      facility: facilities,
      drawerStatus: drawerSessions.status,
    })
    .from(sales)
    .innerJoin(facilities, eq(facilities.id, sales.facilityId))
    .innerJoin(drawerSessions, eq(drawerSessions.id, sales.drawerSessionId))
    .where(
      and(
        eq(sales.id, id),
        eq(sales.orgId, session.orgId),
        eq(sales.facilityId, session.facilityId),
      ),
    );
  if (!row) notFound();
  const { sale, facility } = row;
  if (sale.status === "OPEN") redirect(`/pos/sales/${sale.id}`);

  const [info, lines, tags, settings, returns, returnable] = await Promise.all([
    shellInfo(session),
    db
      .select({
        id: saleLines.id,
        itemName: items.name,
        quantity: saleLines.quantity,
        unitPrice: saleLines.unitPrice,
      })
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
    getRetailSettings(db, sale.facilityId),
    returnsForSale(sale.id),
    returnableLines(db, sale.id),
  ]);
  const canReturn = sale.status === "COMPLETED" && can(session, "pos.manage") && returnable.some((l) => new Decimal(l.returnable).gt(0));
  const canVoid =
    sale.status === "COMPLETED" &&
    row.drawerStatus === "OPEN" &&
    can(session, "pos.manage") &&
    // After a return, the rest is returned, not voided (a void would restock the returned part twice).
    returns.length === 0;

  const justPaid = sale.status === "COMPLETED" && happenedWithin(sale.completedAt, 10 * 60 * 1000);
  const debit = new Decimal(
    sale.debitAmount ??
      (sale.paymentMethod === "DEBIT" ? (sale.total ?? 0) : 0),
  );
  const paidWith =
    sale.paymentMethod === "SPLIT"
      ? [
          ["Debit", usd(debit)],
          ["Cash", usd(sale.cashTendered ?? 0)],
        ]
      : sale.paymentMethod === "CASH"
        ? [["Cash", usd(sale.cashTendered ?? sale.total ?? 0)]]
        : [["Debit", usd(sale.total ?? 0)]];
  const cardNote = sale.cardLast4 || sale.cardRef ? [sale.cardLast4 ? `Card ending ${sale.cardLast4}` : null, sale.cardRef ? `approval ${sale.cardRef}` : null].filter(Boolean).join(" · ") : null;

  return (
    <RegisterShell info={info}>
      <div className="h-full overflow-y-auto p-5 print:overflow-visible print:p-0">
        {justPaid ? (
          <NextCustomer
            total={usd(sale.total ?? 0)}
            change={
              new Decimal(sale.changeDue ?? 0).gt(0)
                ? usd(sale.changeDue ?? 0)
                : null
            }
            number={sale.number}
          />
        ) : null}
        <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-5">
          <div className="md:col-span-3">
            <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
              <Link
                href="/pos"
                className="text-sm font-semibold text-brand-700 hover:underline"
              >
                Back to register
              </Link>
              {sale.status === "COMPLETED" ? (
                <PrintButton label="Print receipt" />
              ) : null}
            </div>
            <div className="bg-white p-5 text-sm text-slate-900 shadow-sm print:p-0 print:shadow-none">
              <div className="text-center">
                <p className="text-base font-bold">{facility.name}</p>
                <p>License {facility.licenseNumber}</p>
                <p className="mt-2">
                  Sale {sale.number} ·{" "}
                  {(sale.completedAt ?? sale.createdAt).toLocaleString("en-US", { timeZone: zone })}
                </p>
                <p>Served by {sale.userName.split(" ")[0]}</p>
                {sale.status !== "COMPLETED" ? (
                  <p className="mt-2">
                    <Pill status={sale.status} />
                  </p>
                ) : null}
              </div>
              {sale.status === "CANCELLED" ? (
                <p className="mt-4 text-center text-slate-600">
                  This cart was cancelled before payment. Nothing was sold.
                </p>
              ) : (
                <>
                  <ul className="mt-4 divide-y divide-dashed divide-slate-300 border-y border-dashed border-slate-400">
                    {lines.map((line) => (
                      <li key={line.id} className="py-2">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{line.itemName}</span>
                          <span>
                            {usd(
                              new Decimal(line.quantity)
                                .mul(line.unitPrice)
                                .toDecimalPlaces(2),
                            )}
                          </span>
                        </div>
                        <p className="text-slate-600">
                          {new Decimal(line.quantity).toString()} ×{" "}
                          {unitPrice(line.unitPrice)}
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
                        <dd className="text-right">
                          -{usd(sale.discountTotal ?? 0)}
                        </dd>
                      </>
                    ) : null}
                    <dt>Cannabis excise tax</dt>
                    <dd className="text-right">{usd(sale.exciseTax ?? 0)}</dd>
                    <dt>Sales tax</dt>
                    <dd className="text-right">{usd(sale.salesTax ?? 0)}</dd>
                    <dt className="border-t border-slate-400 pt-1 text-base font-bold">
                      Total
                    </dt>
                    <dd className="border-t border-slate-400 pt-1 text-right text-base font-bold">
                      {usd(sale.total ?? 0)}
                    </dd>
                    {paidWith.map(([label, amount]) => (
                      <Fragment key={label}>
                        <dt>Paid by {label.toLowerCase()}</dt>
                        <dd className="text-right">{amount}</dd>
                      </Fragment>
                    ))}
                    {sale.paymentMethod !== "DEBIT" ? (
                      <>
                        <dt className="font-semibold">Change</dt>
                        <dd className="text-right font-semibold">
                          {usd(sale.changeDue ?? 0)}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  {cardNote ? (
                    <p className="mt-1 text-xs text-slate-600" data-testid="card-note">
                      {cardNote}
                    </p>
                  ) : null}
                  {sale.status === "VOIDED" ? (
                    <p className="mt-4 font-semibold text-red-700">
                      Voided: {sale.voidReason}
                    </p>
                  ) : null}
                  {returns.length ? (
                    <div className="mt-4 border-t border-dashed border-slate-400 pt-3" data-returns>
                      <p className="font-semibold">Returns</p>
                      <ul className="mt-1 space-y-1">
                        {returns.map((r) => (
                          <li key={r.id} className="flex justify-between gap-3">
                            <span>
                              {r.number} · {r.createdAt.toLocaleDateString("en-US", { timeZone: zone })} · {r.refundMethod === "CASH" ? "cash" : "card"} refund
                              <span className="block text-xs text-slate-500">
                                {r.disposition === "RESTOCK" ? "Back to stock" : "Written off"}: {r.reason}
                              </span>
                            </span>
                            <span>-{usd(r.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
              {settings.receiptWarning && sale.status !== "CANCELLED" ? (
                <p className="mt-4 whitespace-pre-line border-t border-slate-300 pt-3 text-center text-xs font-semibold" data-receipt-warning>
                  {settings.receiptWarning}
                </p>
              ) : null}
            </div>
          </div>

          {canVoid || canReturn ? (
            <div className="space-y-5 md:col-span-2 print:hidden">
            {canReturn ? (
              <Card title="Return items">
                <ActionForm action={returnSaleAction} submitLabel="Record return" quiet>
                  <input type="hidden" name="saleId" value={sale.id} />
                  <ul className="space-y-2">
                    {returnable
                      .filter((l) => new Decimal(l.returnable).gt(0))
                      .map((l) => (
                        <li key={l.saleLineId}>
                          <Field label={`${l.itemName}`} hint={`${l.returnable} of ${l.sold} can be returned`}>
                            <input name={`qty:${l.saleLineId}`} inputMode="decimal" placeholder="0" aria-label={`How many ${l.itemName} are coming back`} className={inputClass} />
                          </Field>
                        </li>
                      ))}
                  </ul>
                  <Field label="Condition">
                    <select name="disposition" required defaultValue="RESTOCK" className={inputClass}>
                      <option value="RESTOCK">Sealed and unopened: back to stock</option>
                      <option value="DISPOSE">Opened or damaged: write it off</option>
                    </select>
                  </Field>
                  <Field label="Refund">
                    <select name="refundMethod" required defaultValue={sale.paymentMethod === "CASH" ? "CASH" : "CARD"} className={inputClass}>
                      <option value="CASH">Cash from my open drawer</option>
                      <option value="CARD">To their card (do it on the card terminal)</option>
                    </select>
                  </Field>
                  <Field label="Reason" hint="Required. Shown in the audit trail.">
                    <input name="reason" required maxLength={300} className={inputClass} />
                  </Field>
                  <p className="text-xs text-slate-500">The refund is the same share of what they paid, after discount and tax, as the items are of the sale.</p>
                </ActionForm>
              </Card>
            ) : null}
            {canVoid ? (
              <Card title="Void this sale">
                <ActionForm
                  action={voidSaleAction}
                  submitLabel="Void sale"
                  quiet
                >
                  <input type="hidden" name="saleId" value={sale.id} />
                  <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900">
                    <Info
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Puts the product back into the packages it came from and
                      removes the sale from today&apos;s totals. Refund the
                      customer by hand.
                    </span>
                  </p>
                  <Field
                    label="Reason"
                    hint="Required. Shown in the audit trail."
                  >
                    <input
                      name="reason"
                      required
                      maxLength={300}
                      className={inputClass}
                    />
                  </Field>
                </ActionForm>
              </Card>
            ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </RegisterShell>
  );
}
