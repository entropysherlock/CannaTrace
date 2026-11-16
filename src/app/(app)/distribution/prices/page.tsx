import { and, asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { DistributionTabs, unitPrice } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { items, priceListItems, priceLists } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { priceAction, priceListAction } from "../actions";

export default async function PricesPage() {
  const session = await requirePagePermission("sales.view");
  const [lists, prices, itemRows] = await Promise.all([
    db.select().from(priceLists).where(eq(priceLists.orgId, session.orgId)).orderBy(asc(priceLists.name)),
    db
      .select({ priceListId: priceListItems.priceListId, price: priceListItems.price, itemName: items.name, unit: items.unit })
      .from(priceListItems)
      .innerJoin(items, eq(items.id, priceListItems.itemId))
      .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
      .where(eq(priceLists.orgId, session.orgId))
      .orderBy(asc(items.name)),
    db
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(and(eq(items.orgId, session.orgId), eq(items.active, true)))
      .orderBy(asc(items.name)),
  ]);
  const canWrite = can(session.role, "sales.write");

  return (
    <>
      <PageHeader title="Price lists" subtitle="Wholesale prices. The default list applies to any customer without their own." />
      <DistributionTabs current="/distribution/prices" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {lists.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
              No price lists yet. The first one you add becomes the default.
            </p>
          ) : (
            lists.map((list) => {
              const rows = prices.filter((p) => p.priceListId === list.id);
              return (
                <Card key={list.id} title={`${list.name}${list.isDefault ? " (default)" : ""}`}>
                  {rows.length === 0 ? (
                    <p className="text-sm text-slate-600">No prices set.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {rows.map((row) => (
                        <li key={row.itemName} className="flex justify-between gap-3 py-2">
                          <span className="text-slate-900">{row.itemName}</span>
                          <span className="font-semibold">
                            {unitPrice(row.price)} per {unitLabel(row.unit)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })
          )}
        </div>
        {canWrite ? (
          <div className="space-y-5">
            {lists.length ? (
              <Card title="Set a price">
                <ActionForm action={priceAction} submitLabel="Save price">
                  <Field label="Price list">
                    <select name="priceListId" required defaultValue={lists.find((l) => l.isDefault)?.id ?? lists[0].id} className={inputClass}>
                      {lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                  </Field>
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
                  <Field label="Price per unit, in dollars" hint="Saving again for the same item replaces the old price.">
                    <input name="price" inputMode="decimal" required className={inputClass} />
                  </Field>
                </ActionForm>
              </Card>
            ) : null}
            <Card title="New price list">
              <ActionForm action={priceListAction} submitLabel="Add price list">
                <Field label="Name">
                  <input name="name" required className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
