import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { unitPrice } from "@/components/distribution-ui";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { discountPresets, facilities, items, retailPrices } from "@/db/schema";
import { labelPackFor } from "@/lib/labels/jurisdictions";
import { PACKS, rulesOf } from "@/lib/rules";
import { StoreRulesForm, type StatePrefill } from "@/components/store-rules-form";
import { db } from "@/lib/db";
import { getRetailSettings } from "@/lib/pos";
import { LIMIT_LABELS } from "@/lib/pos-math";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { discountPresetAction, menuItemAction, removeDiscountAction } from "../actions";

export default async function MenuPage() {
  const session = await requirePagePermission("pos.manage");
  const [[facility], settings, menu, itemRows, discounts] = await Promise.all([
    db.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, session.facilityId)),
    getRetailSettings(db, session.facilityId),
    db
      .select({ id: items.id, name: items.name, unit: items.unit, price: retailPrices.price, limitCategory: items.limitCategory, limitPerUnit: items.limitPerUnit })
      .from(retailPrices)
      .innerJoin(items, eq(items.id, retailPrices.itemId))
      .where(eq(retailPrices.facilityId, session.facilityId))
      .orderBy(asc(items.name)),
    db
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(and(eq(items.orgId, session.orgId), eq(items.active, true)))
      .orderBy(asc(items.name)),
    db
      .select()
      .from(discountPresets)
      .where(and(eq(discountPresets.orgId, session.orgId), eq(discountPresets.active, true)))
      .orderBy(asc(discountPresets.name)),
  ]);
  const num = (value: Decimal.Value) => new Decimal(value).toString();
  const prefills: StatePrefill[] = Object.values(PACKS)
    .map((pack) => {
      const rule = rulesOf(pack, "PURCHASE_LIMIT").find((r) => r.customer === "ADULT_USE");
      if (!rule) return null;
      const str = (v: number | undefined) => (v === undefined ? null : String(Math.round(v * 1000) / 1000));
      return {
        state: pack.state,
        name: pack.name,
        flower: str(rule.flowerGrams),
        concentrate: str(rule.concentrateGrams),
        edible: str(rule.edibleMg),
        combined: str(rule.combinedGrams),
        perDay: rule.period === "DAY",
        summary: rule.summary,
        citation: rule.source.citation,
        url: rule.source.url,
        checked: rule.source.checked,
      };
    })
    .filter((p): p is StatePrefill => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Menu and store rules" subtitle="What this store sells, at what price, and the limits and taxes that apply here." />
      <PosTabs current="/pos/menu" canManage />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={`On the menu (${menu.length})`}>
            {menu.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing yet. Add an item with its shelf price.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {menu.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium text-slate-900">{item.name}</span>
                    <span className="text-right text-slate-600">
                      <span className="font-semibold text-slate-900">
                        {unitPrice(item.price)} per {unitLabel(item.unit)}
                      </span>
                      {" · "}
                      {item.limitCategory === "NONE"
                        ? "not limited"
                        : `counts ${num(item.limitPerUnit ?? 0)} ${LIMIT_LABELS[item.limitCategory].unit} of ${LIMIT_LABELS[item.limitCategory].name.toLowerCase()} each`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Discounts">
            {discounts.length === 0 ? (
              <p className="text-sm text-slate-600">No discounts set up.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {discounts.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span className="font-medium text-slate-900">{d.name}</span>
                    <span className="ml-auto font-semibold">{num(d.percent)}% off</span>
                    <ActionForm action={removeDiscountAction} submitLabel={`Remove ${d.name}`} quiet className="flex items-start">
                      <input type="hidden" name="discountId" value={d.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Add or change a menu item">
            <ActionForm action={menuItemAction} submitLabel="Save menu item">
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
              <Field label="Shelf price per unit, in dollars" hint="Before tax.">
                <input name="price" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="Counts toward which purchase limit">
                <select name="limitCategory" defaultValue="NONE" className={inputClass}>
                  <option value="NONE">None (accessories and the like)</option>
                  <option value="FLOWER">Flower, in grams</option>
                  <option value="CONCENTRATE">Concentrate, in grams</option>
                  <option value="EDIBLE">Edible, in milligrams of THC</option>
                </select>
              </Field>
              <Field label="How much one unit counts" hint="For example 3.5 for a 3.5 g jar, or 100 for a 100 mg pack of gummies. Leave empty for None.">
                <input name="limitPerUnit" inputMode="decimal" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Store rules">
            <StoreRulesForm
              initial={{
                flower: settings.saved ? num(settings.flowerLimitGrams) : "",
                concentrate: settings.saved ? num(settings.concentrateLimitGrams) : "",
                edible: settings.saved ? num(settings.edibleLimitMg) : "",
                excise: settings.saved ? num(settings.exciseTaxPercent) : "",
                sales: settings.saved ? num(settings.salesTaxPercent) : "",
              }}
              medicalTaxExempt={settings.medicalTaxExempt}
              dailyLimits={settings.dailyLimits}
              receiptWarning={settings.receiptWarning ?? ""}
              labelWarning={settings.labelWarning ?? ""}
              labelWarningSuggestion={labelWarningSuggestion(facility?.state)}
              prefills={prefills}
              facilityState={facility?.state ?? ""}
            />
          </Card>

          <Card title="Add a discount">
            <ActionForm action={discountPresetAction} submitLabel="Add discount">
              <Field label="Name">
                <input name="name" required maxLength={60} className={inputClass} />
              </Field>
              <Field label="Percent off">
                <input name="percent" inputMode="decimal" required className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}

/** The state's required label warning, where SmartLabel's verified rules spell out exact wording. */
function labelWarningSuggestion(state: string | null | undefined): { text: string; citation: string } | null {
  const rule = labelPackFor(state)?.rules.find((r) => /warning/i.test(r.title) && r.check.type === "statement");
  return rule && rule.check.type === "statement" ? { text: rule.check.text, citation: rule.citation } : null;
}
