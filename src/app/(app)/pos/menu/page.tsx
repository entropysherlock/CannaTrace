import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect } from "@/components/contextual-create";
import { ItemFields } from "@/components/item-fields";
import { unitPrice } from "@/components/distribution-ui";
import { PosTabs } from "@/components/pos-tabs";
import { reviewCount } from "@/lib/offline-sales";
import { waitingCount } from "@/lib/online-menu";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { discountPresets, facilities, items, retailPrices } from "@/db/schema";
import { labelPackFor } from "@/lib/labels/jurisdictions";
import { PACKS, rulesOf } from "@/lib/rules";
import { StoreRulesForm, type StatePrefill } from "@/components/store-rules-form";
import { db } from "@/lib/db";
import { getRetailSettings } from "@/lib/pos";
import { LIMIT_LABELS } from "@/lib/pos-math";
import { itemCategoryNames } from "@/lib/quick-create-data";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { quickItemAction } from "../../quick-create-actions";
import { unitLabel } from "@/lib/units";
import { getMenuSettings } from "@/lib/online-menu";
import { discountPresetAction, menuItemAction, onlineMenuAction, removeDiscountAction } from "../actions";

export default async function MenuPage() {
  const session = await requirePagePermission("pos.manage");
  const canManageCatalog = can(session, "catalog.manage");
  const categories = canManageCatalog ? await itemCategoryNames(session.orgId) : [];
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
  const online = await getMenuSettings(session.facilityId);
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
      <PosTabs current="/pos/menu" canManage pickups={await waitingCount(session.facilityId)} review={await reviewCount(session.facilityId)} />
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
                  <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2">
                    <span className="min-w-0 break-words font-medium text-slate-900">{d.name}</span>
                    <span className="w-20 text-right font-semibold tabular-nums">{num(d.percent)}% off</span>
                    <ActionForm action={removeDiscountAction} submitLabel="Remove" submitAriaLabel={`Remove ${d.name}`} quiet className="flex items-start">
                      <input type="hidden" name="discountId" value={d.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Online menu and pickups">
            <ActionForm action={onlineMenuAction} submitLabel="Save online menu">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={online?.enabled ?? false} className="mt-0.5 h-5 w-5 accent-brand-700" />
                <span>
                  <span className="font-semibold">Show a public menu for this store</span>
                  <span className="block text-slate-600">Customers see what you can sell right now at your shelf prices, after confirming they are 21 or older. Never stock counts.</span>
                </span>
              </label>
              <Field label="Menu address" hint="Letters, numbers and dashes. The page will be at /menu/your-address.">
                <input name="slug" required defaultValue={online?.slug ?? ""} placeholder="sandia-storefront" className={inputClass} />
              </Field>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="takeReservations" defaultChecked={online?.takeReservations ?? true} className="mt-0.5 h-5 w-5 accent-brand-700" />
                <span>
                  <span className="font-semibold">Let customers reserve for pickup</span>
                  <span className="block text-slate-600">Reservations show on the Pickups tab. They pay and show ID in the store.</span>
                </span>
              </label>
              <Field label="Welcome message (optional)">
                <textarea name="welcome" rows={2} maxLength={400} defaultValue={online?.welcome ?? ""} className={inputClass} />
              </Field>
              <Field label="Pickup instructions (optional)" hint="Shown after a customer reserves. For example: hours and where to park.">
                <textarea name="pickupNote" rows={2} maxLength={400} defaultValue={online?.pickupNote ?? ""} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
          <Card title="Add or change a menu item">
            <ActionForm action={menuItemAction} submitLabel="Save menu item">
              <CreatableSelect
                name="itemId" searchable
                label="Item"
                required
                placeholder="Choose an item"
                options={itemRows.map((item) => ({ id: item.id, label: `${item.name} (${unitLabel(item.unit)})` }))}
                create={
                  canManageCatalog
                    ? {
                        buttonLabel: "Add item",
                        title: "Add an item",
                        intro: "It goes into your catalog too, and is picked here so you can set its shelf price.",
                        submitLabel: "Save item",
                        action: quickItemAction,
                        fields: <ItemFields categories={categories} />,
                      }
                    : undefined
                }
                deniedHint="Item missing? Someone who manages the catalog can add it on the Items page."
              />
              <Field label="Shelf price per unit, in dollars" hint="Before tax.">
                <input name="price" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="Barcode (optional)" hint="Click here, then scan the product's barcode with your scanner (or type the numbers). The register will ring this item up when it's scanned. Leave blank to keep the barcode it has now.">
                <input name="barcode" inputMode="numeric" autoComplete="off" maxLength={48} placeholder="Scan the barcode here" className={`${inputClass} font-mono`} />
              </Field>
              <Field label="Counts toward which purchase limit" hint="Changing only the price? Leave this on Keep, so the item's purchase limit stays as it is.">
                <select name="limitCategory" defaultValue="KEEP" className={inputClass}>
                  <option value="KEEP">Keep what the item counts toward now</option>
                  <option value="NONE">None (accessories and the like)</option>
                  <option value="FLOWER">Flower, in grams</option>
                  <option value="CONCENTRATE">Concentrate, in grams</option>
                  <option value="EDIBLE">Edible, in milligrams of THC</option>
                </select>
              </Field>
              <Field label="How much one unit counts" hint="For example 3.5 for a 3.5 g jar, or 100 for a 100 mg pack of gummies. Leave empty for Keep or None.">
                <input name="limitPerUnit" inputMode="decimal" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <div id="store-rules" className="scroll-mt-4">
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
          </div>

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
