import { asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { itemCategories, items, unitEnum } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { addCategory, addItem, setItemActive } from "./actions";

export default async function CatalogPage() {
  const session = await requirePagePermission("catalog.manage");
  const [categories, rows] = await Promise.all([
    db.select().from(itemCategories).where(eq(itemCategories.orgId, session.orgId)).orderBy(asc(itemCategories.name)),
    db
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        unit: items.unit,
        strain: items.strain,
        active: items.active,
        categoryName: itemCategories.name,
      })
      .from(items)
      .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
      .where(eq(items.orgId, session.orgId))
      .orderBy(asc(items.name)),
  ]);

  return (
    <>
      <PageHeader title="Items" subtitle="The products you track. Shared across all of your facilities." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`${rows.length} item${rows.length === 1 ? "" : "s"}`}>
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className={item.active ? "" : "opacity-50"}>
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <p className="text-slate-600">
                      {item.sku} · {item.categoryName} · tracked in {unitLabel(item.unit)}
                      {item.strain ? ` · ${item.strain}` : ""}
                      {item.active ? "" : " · retired"}
                    </p>
                  </div>
                  <form action={setItemActive}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="active" value={item.active ? "false" : "true"} />
                    <button type="submit" className="min-h-10 rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">
                      {item.active ? "Retire" : "Bring back"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Add an item">
            {categories.length === 0 ? (
              <p className="text-sm text-slate-600">Add a category first.</p>
            ) : (
              <ActionForm action={addItem} submitLabel="Add item">
                <Field label="Name">
                  <input name="name" required className={inputClass} />
                </Field>
                <Field label="SKU">
                  <input name="sku" required autoCapitalize="characters" className={inputClass} />
                </Field>
                <Field label="Category">
                  <select name="categoryId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a category
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Unit of measure" hint="Cannot be changed later, because existing packages depend on it.">
                  <select name="unit" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a unit
                    </option>
                    {unitEnum.enumValues.map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Strain (optional)">
                  <input name="strain" className={inputClass} />
                </Field>
              </ActionForm>
            )}
          </Card>
          <Card title="Add a category">
            <ActionForm action={addCategory} submitLabel="Add category">
              <Field label="Name" hint={categories.length ? `Existing: ${categories.map((c) => c.name).join(", ")}` : undefined}>
                <input name="name" required className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
