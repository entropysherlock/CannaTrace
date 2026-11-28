import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { itemCategories, items } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { trim } from "@/lib/labels/quantities";
import { unitLabel } from "@/lib/units";
import { findNameTwins } from "@/lib/merge-items";
import { mergeItemsAction, renameItemAction, saveItemDetailsAction } from "../actions";

const num = (v: string | number | null) => (v === null ? "" : trim(v, 3));
const textareaClass = `${inputClass} py-2`;

export default async function ItemDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("catalog.manage");
  const { id } = await params;
  const [row] = await db
    .select({ item: items, category: itemCategories.name })
    .from(items)
    .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(and(eq(items.id, id), eq(items.orgId, session.orgId)));
  if (!row) notFound();
  const { item, category } = row;
  const counted = item.unit === "EACH";
  const twins = item.active ? await findNameTwins(session.orgId, item.id) : [];

  return (
    <>
      <PageHeader title={item.name} subtitle={`${item.sku} · ${category} · tracked in ${unitLabel(item.unit)}${item.strain ? ` · ${item.strain}` : ""}`} />
      <p className="mb-4 text-sm">
        <Link href="/catalog" className="font-semibold text-brand-700 hover:underline">
          ‹ All items
        </Link>
      </p>
      <div className="mb-5 max-w-2xl">
        <Card title="Name, SKU and barcode">
          <ActionForm action={renameItemAction} submitLabel="Save">
            <input type="hidden" name="itemId" value={item.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input name="name" required maxLength={120} defaultValue={item.name} className={inputClass} />
              </Field>
              <Field label="SKU" hint="Generated when the item was added. Change it if you need to match your own numbering; it must be unique.">
                <input name="sku" required maxLength={40} autoCapitalize="characters" defaultValue={item.sku} className={`${inputClass} font-mono`} />
              </Field>
              <Field label="Barcode" hint="The product's own barcode. Click here and scan it, and the register will ring this item up when it's scanned. Clear it to remove.">
                <input name="barcode" inputMode="numeric" autoComplete="off" maxLength={48} defaultValue={item.barcode ?? ""} className={`${inputClass} font-mono`} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
      {twins.length ? (
        <div className="mb-5 max-w-2xl" data-testid="merge-twins">
          <Card title="Duplicate items">
            <p className="mb-3 text-sm text-slate-700">
              {twins.length === 1 ? "Another item has" : `${twins.length} other items have`} the same name as this one: {twins.map((t) => `${t.name} (${t.sku})`).join(", ")}. Merging moves their packages,
              sales, orders, recipes and prices onto this item and retires them. It cannot be undone.
            </p>
            <ActionForm action={mergeItemsAction} submitLabel={`Merge ${twins.length} into this item`}>
              <input type="hidden" name="keepId" value={item.id} />
            </ActionForm>
          </Card>
        </div>
      ) : null}
      <ActionForm action={saveItemDetailsAction} submitLabel="Save label details">
        <input type="hidden" name="itemId" value={item.id} />
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Size and dose">
            <div className="space-y-3">
              <Field
                label="Unit weight (grams)"
                hint={
                  counted
                    ? "The weight of one unit, for example 1 for a 1 g pre-roll. Labels use it for net weight in g and oz."
                    : `This item is tracked by ${unitLabel(item.unit)}, so labels already know its weight. Fill this in only if one unit is a fixed size.`
                }
              >
                <input name="unitWeightGrams" inputMode="decimal" defaultValue={num(item.unitWeightGrams)} className={inputClass} />
              </Field>
              <Field label="Servings per unit" hint="For edibles, tinctures, and other dosed products. Leave blank for flower.">
                <input name="servingsPerUnit" inputMode="numeric" defaultValue={item.servingsPerUnit ?? ""} className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="THC per serving (mg)">
                  <input name="thcMgPerServing" inputMode="decimal" defaultValue={num(item.thcMgPerServing)} className={inputClass} />
                </Field>
                <Field label="CBD per serving (mg)">
                  <input name="cbdMgPerServing" inputMode="decimal" defaultValue={num(item.cbdMgPerServing)} className={inputClass} />
                </Field>
              </div>
              <p className="text-xs text-slate-600">
                Under 1 mg prints as &quot;&lt;1 mg&quot;, as New Mexico allows. Lab-tested potency (THC %, the cannabinoid profile) comes from each
                package&apos;s lab result.
              </p>
              <Field
                label="Shelf life (days)"
                hint="Labels print the expiration date as the date packaged plus this many days. Leave blank if you don't set one."
              >
                <input name="shelfLifeDays" inputMode="numeric" defaultValue={item.shelfLifeDays ?? ""} className={inputClass} />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="mustRefrigerate" value="yes" defaultChecked={item.mustRefrigerate} className="mt-0.5 h-5 w-5 accent-brand-700" />
                <span>
                  <span className="font-semibold text-slate-800">Must be kept refrigerated</span>
                  <span className="block text-slate-600">Perishable edibles and topicals. Labels can then print &quot;Keep refrigerated.&quot;</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="returnable" value="yes" defaultChecked={item.returnable} className="mt-0.5 h-5 w-5 accent-brand-700" />
                <span>
                  <span className="font-semibold text-slate-800">Store takes this back</span>
                  <span className="block text-slate-600">Leave off for most cannabis products. Reward points can&apos;t pay for a returnable item, so a returned sale never keeps the reward value.</span>
                </span>
              </label>
            </div>
          </Card>
          <Card title="What's in it and how to use it">
            <div className="space-y-3">
              <Field label="Intended use and directions" hint='For example "For inhalation. Light the end and inhale slowly."'>
                <textarea name="directions" rows={2} maxLength={500} defaultValue={item.directions ?? ""} className={textareaClass} />
              </Field>
              <Field label="Ingredients" hint="In order from most to least by weight. Include the cannabis extract or concentrate.">
                <textarea name="ingredients" rows={3} maxLength={1500} defaultValue={item.ingredients ?? ""} className={textareaClass} />
              </Field>
              <Field label="Allergens" hint='For example "Contains: milk, soy". Leave blank if there are none.'>
                <input name="allergens" maxLength={300} defaultValue={item.allergens ?? ""} className={inputClass} />
              </Field>
              <Field label="Pesticides used" hint='Write "None" if none were used, so the label says so.'>
                <input name="pesticides" maxLength={500} defaultValue={item.pesticides ?? ""} className={inputClass} />
              </Field>
              <Field label="Solvents and processing aids" hint="For concentrates and extracts. Leave blank if none were used.">
                <input name="solvents" maxLength={500} defaultValue={item.solvents ?? ""} className={inputClass} />
              </Field>
            </div>
          </Card>
        </div>
      </ActionForm>
    </>
  );
}
