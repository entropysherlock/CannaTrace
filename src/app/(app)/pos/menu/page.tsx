import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { unitPrice } from "@/components/distribution-ui";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { discountPresets, items, retailPrices } from "@/db/schema";
import { db } from "@/lib/db";
import { getRetailSettings } from "@/lib/pos";
import { LIMIT_LABELS } from "@/lib/pos-math";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { discountPresetAction, menuItemAction, retailSettingsAction } from "../actions";

export default async function MenuPage() {
  const session = await requirePagePermission("pos.manage");
  const [settings, menu, itemRows, discounts] = await Promise.all([
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
    db.select().from(discountPresets).where(eq(discountPresets.orgId, session.orgId)).orderBy(asc(discountPresets.name)),
  ]);
  const num = (value: Decimal.Value) => new Decimal(value).toString();

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
                  <li key={d.id} className="flex justify-between gap-3 py-2">
                    <span className="font-medium text-slate-900">{d.name}</span>
                    <span className="font-semibold">{num(d.percent)}% off</span>
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
            <ActionForm action={retailSettingsAction} submitLabel="Save store rules">
              <p className="text-sm text-slate-600">
                Limits and tax rates are set by your state and city and they change. Enter the current figures for this store; CannaTrace does not look them up. The register stays locked until these are saved.
              </p>
              <Field label="Flower limit per purchase, in grams">
                <input name="flowerLimitGrams" inputMode="decimal" required defaultValue={settings.saved ? num(settings.flowerLimitGrams) : ""} className={inputClass} />
              </Field>
              <Field label="Concentrate limit per purchase, in grams">
                <input name="concentrateLimitGrams" inputMode="decimal" required defaultValue={settings.saved ? num(settings.concentrateLimitGrams) : ""} className={inputClass} />
              </Field>
              <Field label="Edible limit per purchase, in milligrams of THC">
                <input name="edibleLimitMg" inputMode="decimal" required defaultValue={settings.saved ? num(settings.edibleLimitMg) : ""} className={inputClass} />
              </Field>
              <Field label="Cannabis excise tax, percent">
                <input name="exciseTaxPercent" inputMode="decimal" required defaultValue={settings.saved ? num(settings.exciseTaxPercent) : ""} className={inputClass} />
              </Field>
              <Field label="Sales tax, percent">
                <input name="salesTaxPercent" inputMode="decimal" required defaultValue={settings.saved ? num(settings.salesTaxPercent) : ""} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="medicalTaxExempt" defaultChecked={settings.medicalTaxExempt} className="h-5 w-5 accent-brand-700" />
                Medical patients pay no tax
              </label>
            </ActionForm>
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
