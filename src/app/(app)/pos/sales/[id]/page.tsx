import Decimal from "decimal.js";
import { and, asc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { unitPrice, usd } from "@/components/distribution-ui";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputBase, inputClass } from "@/components/ui";
import { discountPresets, items, packages, retailPrices, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { cartLines, getRetailSettings, saleTotals } from "@/lib/pos";
import { LIMIT_LABELS, limitUsage } from "@/lib/pos-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { addToCartAction, cancelCartAction, cartDiscountAction, payAction, removeFromCartAction } from "../../actions";

export default async function CartPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("pos.use");
  const { id } = await params;
  const [sale] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, id), eq(sales.orgId, session.orgId), eq(sales.facilityId, session.facilityId)));
  if (!sale) notFound();
  if (sale.status !== "OPEN") redirect(`/pos/sales/${sale.id}/receipt`);

  const [lines, settings, menu, discounts] = await Promise.all([
    cartLines(db, sale.id),
    getRetailSettings(db, session.facilityId),
    db
      .select({
        id: items.id,
        name: items.name,
        unit: items.unit,
        price: retailPrices.price,
        stock: sql<string>`coalesce((select sum(${packages.quantity}) from ${packages} where ${packages.itemId} = ${items.id} and ${packages.facilityId} = ${session.facilityId} and ${packages.status} = 'ACTIVE'), 0)`,
      })
      .from(retailPrices)
      .innerJoin(items, eq(items.id, retailPrices.itemId))
      .where(and(eq(retailPrices.facilityId, session.facilityId), eq(items.active, true)))
      .orderBy(asc(items.name)),
    db
      .select()
      .from(discountPresets)
      .where(and(eq(discountPresets.orgId, session.orgId), eq(discountPresets.active, true)))
      .orderBy(asc(discountPresets.name)),
  ]);
  const totals = saleTotals(lines, sale, settings);
  const usage = limitUsage(lines);
  const limits = { FLOWER: settings.flowerLimitGrams, CONCENTRATE: settings.concentrateLimitGrams, EDIBLE: settings.edibleLimitMg };
  const hidden = <input type="hidden" name="saleId" value={sale.id} />;
  const num = (value: Decimal.Value) => new Decimal(value).toString();
  const taxExempt = sale.customerType === "MEDICAL" && settings.medicalTaxExempt;

  return (
    <>
      <PageHeader
        title={`Cart ${sale.number}`}
        subtitle={`${sale.customerType === "MEDICAL" ? "Medical patient" : "Adult use"} · ID checked by ${sale.userName}`}
        action={
          <Link href="/pos" className="text-sm font-semibold text-brand-700 hover:underline">
            Back to register
          </Link>
        }
      />
      <PosTabs current="/pos" canManage={can(session.role, "pos.manage")} />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title="Menu">
            {menu.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing is on this store&apos;s menu yet. A manager can add items under Menu and store rules.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {menu.map((item) => {
                  const out = new Decimal(item.stock).lte(0);
                  return (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className={out ? "opacity-50" : ""}>
                        <p className="font-semibold text-slate-900">{item.name}</p>
                        <p className="text-slate-600">
                          {unitPrice(item.price)} per {unitLabel(item.unit)} · {out ? "out of stock" : `${num(item.stock)} in stock`}
                        </p>
                      </div>
                      {out ? null : (
                        <ActionForm action={addToCartAction} submitLabel="Add" className="flex flex-wrap items-center justify-end gap-2">
                          {hidden}
                          <input type="hidden" name="itemId" value={item.id} />
                          <input
                            name="quantity"
                            inputMode="decimal"
                            defaultValue="1"
                            aria-label={`Quantity of ${item.name}`}
                            className={`${inputBase} w-20`}
                          />
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title="In the cart">
            {lines.length === 0 ? (
              <p className="text-sm text-slate-600">Empty. Add items from the menu.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {lines.map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium text-slate-900">{line.itemName}</p>
                      <p className="text-slate-600">
                        {num(line.quantity)} × {unitPrice(line.unitPrice)} = {usd(new Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2))}
                      </p>
                    </div>
                    <ActionForm action={removeFromCartAction} submitLabel="Remove" quiet className="flex flex-col items-end gap-1">
                      <input type="hidden" name="lineId" value={line.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
              <p className="font-medium text-slate-700">Purchase limits</p>
              {(["FLOWER", "CONCENTRATE", "EDIBLE"] as const).map((category) => {
                const used = usage[category];
                const limit = new Decimal(limits[category]);
                const share = limit.gt(0) ? Decimal.min(100, used.div(limit).mul(100)).toNumber() : 0;
                return (
                  <div key={category}>
                    <div className="flex justify-between text-slate-600">
                      <span>{LIMIT_LABELS[category].name}</span>
                      <span>
                        {num(used)} of {num(limit)} {LIMIT_LABELS[category].unit}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full ${share >= 100 ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Total">
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-slate-600">Subtotal</dt>
              <dd className="text-right">{usd(totals.subtotal)}</dd>
              {totals.discount.gt(0) ? (
                <>
                  <dt className="text-slate-600">
                    Discount ({sale.discountName}, {num(sale.discountPercent)}%)
                  </dt>
                  <dd className="text-right">-{usd(totals.discount)}</dd>
                </>
              ) : null}
              <dt className="text-slate-600">Cannabis excise tax{taxExempt ? " (exempt)" : ` (${num(settings.exciseTaxPercent)}%)`}</dt>
              <dd className="text-right">{usd(totals.exciseTax)}</dd>
              <dt className="text-slate-600">Sales tax{taxExempt ? " (exempt)" : ` (${num(settings.salesTaxPercent)}%)`}</dt>
              <dd className="text-right">{usd(totals.salesTax)}</dd>
              <dt className="border-t border-slate-200 pt-2 text-base font-bold text-slate-900">Total due</dt>
              <dd className="border-t border-slate-200 pt-2 text-right text-2xl font-bold text-slate-900">{usd(totals.total)}</dd>
            </dl>
            {discounts.length ? (
              <ActionForm action={cartDiscountAction} submitLabel="Apply discount" className="mt-4 space-y-2">
                {hidden}
                <select name="discountId" defaultValue="" aria-label="Discount" className={inputClass}>
                  <option value="">No discount</option>
                  {discounts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({num(d.percent)}%)
                    </option>
                  ))}
                </select>
              </ActionForm>
            ) : null}
          </Card>

          <Card title="Take payment">
            <ActionForm action={payAction} submitLabel={`Complete sale · ${usd(totals.total)}`}>
              {hidden}
              <Field label="Paid with">
                <select name="paymentMethod" defaultValue="CASH" className={inputClass}>
                  <option value="CASH">Cash</option>
                  <option value="DEBIT">Debit</option>
                </select>
              </Field>
              <Field label="Cash handed over, in dollars" hint="Leave empty for debit.">
                <input name="cashTendered" inputMode="decimal" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Cancel this cart">
            <ActionForm action={cancelCartAction} submitLabel="Cancel cart" quiet>
              {hidden}
              <p className="text-sm text-slate-600">Nothing has left inventory yet, so cancelling changes no stock.</p>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
