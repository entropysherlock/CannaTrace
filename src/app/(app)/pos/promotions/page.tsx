import { and, asc, eq } from "drizzle-orm";
import { itemCategories, items } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { db } from "@/lib/db";
import { reviewCount } from "@/lib/offline-sales";
import { waitingCount } from "@/lib/online-menu";
import {
  listPromotions,
  promotionResults,
  rowToPromo,
  storeClock,
} from "@/lib/promotions";
import { WEEKDAY_NAMES, describePromo, isRunning } from "@/lib/promotions-math";
import { requirePagePermission } from "@/lib/session";
import {
  promotionCreateAction,
  promotionDeleteAction,
  promotionToggleAction,
} from "../actions";

export const metadata = { title: "Promotions · Leaf2Sale" };

export default async function PromotionsPage() {
  const session = await requirePagePermission("pos.manage");
  const [rows, categories, products, clock, results] = await Promise.all([
    listPromotions(db, session.orgId),
    db
      .select()
      .from(itemCategories)
      .where(eq(itemCategories.orgId, session.orgId))
      .orderBy(asc(itemCategories.name)),
    db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.orgId, session.orgId), eq(items.active, true)))
      .orderBy(asc(items.name)),
    storeClock(session.facilityId),
    promotionResults(db, session.orgId),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const itemName = new Map(products.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader
        title="Promotions"
        subtitle="Deals the register applies by itself: a percent or dollars off a category, a product or everything, on the days and hours you choose."
      />
      <PosTabs
        current="/pos/promotions"
        canManage
        pickups={await waitingCount(session.facilityId)}
        review={await reviewCount(session.facilityId)}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={`Your promotions (${rows.length})`}>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-600">
                No promotions yet. Add one on the right, like “Wax Wednesday:
                20% off concentrates, Wednesdays”.
              </p>
            ) : (
              <ul
                className="divide-y divide-slate-100 text-sm"
                data-testid="promotions"
              >
                {rows.map((r) => {
                  const p = rowToPromo(r);
                  const running = isRunning(p, clock);
                  const target =
                    r.scope === "ALL"
                      ? "Everything"
                      : r.scope === "CATEGORY"
                        ? (catName.get(r.categoryId ?? "") ?? "A category")
                        : (itemName.get(r.itemId ?? "") ?? "A product");
                  return (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {r.name}{" "}
                          <span
                            className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${!r.active ? "bg-slate-100 text-slate-600" : running ? "bg-brand-100 text-brand-800" : "bg-amber-50 text-amber-800"}`}
                          >
                            {!r.active
                              ? "Off"
                              : running
                                ? "Running now"
                                : "Scheduled"}
                          </span>
                        </p>
                        <p className="text-slate-600">
                          {target} · {describePromo(p)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <ActionForm
                          action={promotionToggleAction}
                          submitLabel={r.active ? "Turn off" : "Turn on"}
                          quiet
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            type="hidden"
                            name="active"
                            value={r.active ? "false" : "true"}
                          />
                        </ActionForm>
                        <ActionForm
                          action={promotionDeleteAction}
                          submitLabel="Delete"
                          submitAriaLabel={`Delete ${r.name}`}
                          quiet
                        >
                          <input type="hidden" name="id" value={r.id} />
                        </ActionForm>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Results, last 30 days">
            {results.length === 0 ? (
              <p className="text-sm text-slate-600">
                No promotion has been used on a completed sale in the last 30
                days.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="w-full text-sm"
                  data-testid="promotion-results"
                >
                  <thead>
                    <tr className="text-left text-slate-600">
                      <th className="py-1 pr-3 font-semibold">Promotion</th>
                      <th className="py-1 pr-3 text-right font-semibold">
                        Sales
                      </th>
                      <th className="py-1 pr-3 text-right font-semibold">
                        Items
                      </th>
                      <th className="py-1 pr-3 text-right font-semibold">
                        Money off
                      </th>
                      <th className="py-1 text-right font-semibold">
                        Sales total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.map((r) => (
                      <tr key={r.promoId}>
                        <td className="py-1.5 pr-3 font-medium text-slate-900">
                          {r.name}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {r.sales}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {r.lines}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          ${Number(r.discount).toFixed(2)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          ${Number(r.salesTotal).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Counts completed sales only; voided sales drop out. “Sales total”
              is what customers paid on the sales the promotion was used in,
              including everything else in the cart.
            </p>
          </Card>
          <Card title="How promotions work">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>
                The register applies a running promotion to the matching items
                by itself. The cart and the customer screen show the savings.
              </li>
              <li>
                If more than one promotion fits an item, the single best one
                applies. They don&apos;t pile up.
              </li>
              <li>
                A promotion only takes money off. Buy-some-get-some deals
                discount the cheapest items; whole items only (a weighed 1.5 g
                line doesn&apos;t count). At least 10% of an item&apos;s price
                is always charged, because New Mexico doesn&apos;t allow giving
                cannabis away free (16.8.2.40(J) NMAC). Deals like “buy one, get
                one 50% off” are supported; a “$1 second item” is not, since it
                comes too close to free. Ask your attorney or the Cannabis
                Control Division before running any deal that comes close to
                free.
              </li>
              <li>
                A cart&apos;s manual discount and rewards come off after
                promotions. Times are your store&apos;s local time.
              </li>
            </ul>
          </Card>
        </div>
        <Card title="Add a promotion">
          <ActionForm
            action={promotionCreateAction}
            submitLabel="Add promotion"
          >
            <Field label="Name">
              <input
                autoComplete="off"
                name="name"
                required
                placeholder="Wax Wednesday"
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select
                  name="kind"
                  defaultValue="PERCENT"
                  className={inputClass}
                >
                  <option value="PERCENT">Percent off</option>
                  <option value="DOLLAR">Dollars off each</option>
                  <option value="BOGO">Buy some, get some % off</option>
                  <option value="BUNDLE">Any few for a set price</option>
                </select>
              </Field>
              <Field
                label="Amount"
                hint="20 means 20% or $20. For a bundle, the price of the whole bundle."
              >
                <input
                  autoComplete="off"
                  name="amount"
                  inputMode="decimal"
                  required
                  className={inputClass}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Buy / bundle size"
                hint="For a deal: how many are bought at full price (or make a bundle)."
              >
                <input
                  autoComplete="off"
                  name="buyQty"
                  inputMode="numeric"
                  placeholder="1"
                  className={inputClass}
                />
              </Field>
              <Field
                label="Then discounted"
                hint="Buy some, get some: how many get the % off."
              >
                <input
                  autoComplete="off"
                  name="getQty"
                  inputMode="numeric"
                  placeholder="1"
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Applies to">
              <select name="scope" defaultValue="ALL" className={inputClass}>
                <option value="ALL">Everything</option>
                <option value="CATEGORY">One category</option>
                <option value="ITEM">One product</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category (if one category)">
                <select
                  name="categoryId"
                  defaultValue=""
                  className={inputClass}
                >
                  <option value="">Choose…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Product (if one product)">
                <select name="itemId" defaultValue="" className={inputClass}>
                  <option value="">Choose…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-slate-800">
                Days (none checked means every day)
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {WEEKDAY_NAMES.map((d, i) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={i}
                      className="h-4 w-4 accent-brand-700"
                    />{" "}
                    {d.slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From (optional)" hint="Like 16:20">
                <input
                  autoComplete="off"
                  name="startTime"
                  placeholder="HH:MM"
                  className={inputClass}
                />
              </Field>
              <Field label="Until (optional)" hint="Like 19:00">
                <input
                  autoComplete="off"
                  name="endTime"
                  placeholder="HH:MM"
                  className={inputClass}
                />
              </Field>
              <Field label="Start date (optional)">
                <input
                  autoComplete="off"
                  type="date"
                  name="startDate"
                  className={inputClass}
                />
              </Field>
              <Field label="End date (optional)">
                <input
                  autoComplete="off"
                  type="date"
                  name="endDate"
                  className={inputClass}
                />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
