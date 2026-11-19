import Decimal from "decimal.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { RecipeForm } from "@/components/recipe-form";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Card, PageHeader, buttonLinkClass } from "@/components/ui";
import { bomLines, boms, itemCategories, items } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireAnyPagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { recipeActiveAction } from "../actions";

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await requireAnyPagePermission("manufacturing.write", "audit.view");
  const { new: adding } = await searchParams;
  const [recipes, itemRows, categories] = await Promise.all([
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
    db.select({ name: itemCategories.name }).from(itemCategories).where(eq(itemCategories.orgId, session.orgId)).orderBy(asc(itemCategories.name)),
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
  const canWrite = can(session, "manufacturing.write");
  const showForm = canWrite && (adding === "1" || recipes.length === 0);

  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle="A recipe (bill of materials) lists what one batch uses and how much it makes."
        action={
          canWrite && !showForm ? (
            <Link href="/manufacturing/recipes?new=1#new-recipe" className={buttonLinkClass} data-testid="new-recipe">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New recipe
            </Link>
          ) : null
        }
      />
      <ManufacturingTabs current="/manufacturing/recipes" />
      {showForm ? (
        <div id="new-recipe" className="mx-auto mb-6 max-w-3xl scroll-mt-4">
          <Card
            title="New recipe"
            action={
              recipes.length > 0 ? (
                <Link href="/manufacturing/recipes" className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Close
                </Link>
              ) : null
            }
          >
            <RecipeForm items={itemRows.map((item) => ({ id: item.id, label: `${item.name} (${unitLabel(item.unit)})` }))} categories={categories.map((c) => c.name)} />
          </Card>
        </div>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
          {recipes.length === 0 ? (
            showForm ? null : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600 md:col-span-2">No recipes yet.</p>
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
    </>
  );
}
