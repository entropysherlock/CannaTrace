import Decimal from "decimal.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionForm } from "@/components/action-form";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { Card, Field, PageHeader, inputBase, inputClass } from "@/components/ui";
import { bomLines, boms, items } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { recipeAction, recipeActiveAction } from "../actions";

export default async function RecipesPage() {
  const session = await requirePagePermission("inventory.view");
  const [recipes, itemRows] = await Promise.all([
    db
      .select({ id: boms.id, name: boms.name, outputQuantity: boms.outputQuantity, active: boms.active, itemName: items.name, unit: items.unit })
      .from(boms)
      .innerJoin(items, eq(items.id, boms.outputItemId))
      .where(eq(boms.orgId, session.orgId))
      .orderBy(asc(boms.name)),
    db
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(and(eq(items.orgId, session.orgId), eq(items.active, true)))
      .orderBy(asc(items.name)),
  ]);
  const inputItem = alias(items, "input_item");
  const lines = recipes.length
    ? await db
        .select({ bomId: bomLines.bomId, quantity: bomLines.quantity, itemName: inputItem.name, unit: inputItem.unit })
        .from(bomLines)
        .innerJoin(inputItem, eq(inputItem.id, bomLines.itemId))
        .where(inArray(bomLines.bomId, recipes.map((r) => r.id)))
        .orderBy(asc(inputItem.name))
    : [];
  const canWrite = can(session.role, "manufacturing.write");
  const itemOptions = itemRows.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name} ({unitLabel(item.unit)})
    </option>
  ));

  return (
    <>
      <PageHeader title="Recipes" subtitle="A recipe (bill of materials) lists what one batch uses and how much it makes." />
      <ManufacturingTabs current="/manufacturing/recipes" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {recipes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No recipes yet.</p>
          ) : (
            recipes.map((recipe) => (
              <Card
                key={recipe.id}
                title={`${recipe.name}${recipe.active ? "" : " (retired)"}`}
                action={
                  canWrite ? (
                    <form action={recipeActiveAction}>
                      <input type="hidden" name="recipeId" value={recipe.id} />
                      <input type="hidden" name="active" value={recipe.active ? "false" : "true"} />
                      <button type="submit" className="min-h-10 rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">
                        {recipe.active ? "Retire" : "Bring back"}
                      </button>
                    </form>
                  ) : null
                }
              >
                <p className="text-sm text-slate-700">
                  One batch makes{" "}
                  <span className="font-semibold">
                    {new Decimal(recipe.outputQuantity).toString()} {unitLabel(recipe.unit)}
                  </span>{" "}
                  of {recipe.itemName}, using:
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                  {lines
                    .filter((line) => line.bomId === recipe.id)
                    .map((line) => (
                      <li key={line.itemName}>
                        {new Decimal(line.quantity).toString()} {unitLabel(line.unit)} of {line.itemName}
                      </li>
                    ))}
                </ul>
              </Card>
            ))
          )}
        </div>
        {canWrite ? (
          <Card title="New recipe">
            <ActionForm action={recipeAction} submitLabel="Save recipe">
              <Field label="Recipe name">
                <input name="name" required className={inputClass} />
              </Field>
              <Field label="What it makes">
                <select name="outputItemId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose an item
                  </option>
                  {itemOptions}
                </select>
              </Field>
              <Field label="How much one batch makes" hint="In that item's unit of measure.">
                <input name="outputQuantity" inputMode="decimal" required className={inputClass} />
              </Field>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium text-slate-700">What one batch uses</legend>
                {[1, 2, 3, 4, 5].map((row) => (
                  <div key={row} className="flex gap-2">
                    <select name="inputItemId" defaultValue="" aria-label={`Input item ${row}`} className={`${inputBase} flex-1`}>
                      <option value="">{row === 1 ? "Choose an item" : "None"}</option>
                      {itemOptions}
                    </select>
                    <input name="inputQuantity" aria-label={`Input quantity ${row}`} placeholder="Qty" inputMode="decimal" className={`${inputBase} w-24 shrink-0`} />
                  </div>
                ))}
                <p className="text-xs text-slate-500">Quantities are in each item&apos;s own unit. Leave unused rows empty.</p>
              </fieldset>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
