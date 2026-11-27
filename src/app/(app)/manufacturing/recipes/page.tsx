import Decimal from "decimal.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionForm } from "@/components/action-form";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { RecipeForm } from "@/components/recipe-form";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Card, Field, PageHeader, buttonLinkClass, inputClass } from "@/components/ui";
import { InventoryError } from "@/lib/inventory-math";
import { planFor } from "@/lib/manufacturing";
import { automationDecision } from "@/lib/automation";
import { suggestRunName } from "@/lib/manufacturing-math";
import { bomLines, boms, itemCategories, items, locations } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireAnyPagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { playAction, recipeActiveAction, startChainAction } from "../actions";

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ new?: string; plan?: string; batches?: string }> }) {
  const session = await requireAnyPagePermission("manufacturing.write", "audit.view");
  const { new: adding, plan: planId, batches: planBatches } = await searchParams;
  const [recipes, itemRows, categories] = await Promise.all([
    db
      .select({ id: boms.id, outputItemId: boms.outputItemId, name: boms.name, outputQuantity: boms.outputQuantity, active: boms.active, itemName: items.name, unit: items.unit })
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
        .select({ bomId: bomLines.bomId, itemId: bomLines.itemId, quantity: bomLines.quantity, itemName: inputItem.name, unit: inputItem.unit })
        .from(bomLines)
        .innerJoin(inputItem, eq(inputItem.id, bomLines.itemId))
        .where(inArray(bomLines.bomId, recipes.map((r) => r.id)))
        .orderBy(asc(inputItem.name))
    : [];
  const canWrite = can(session, "manufacturing.write");
  const makers = new Set(recipes.filter((r) => r.active).map((r) => r.outputItemId));
  const itemById = new Map(itemRows.map((i) => [i.id, i]));
  let plan: Awaited<ReturnType<typeof planFor>> | null = null;
  let planProblem: string | null = null;
  const actorForPlan = { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
  if (planId && planBatches) {
    try {
      plan = await planFor(actorForPlan, { recipeId: planId, batches: planBatches });
    } catch (error) {
      planProblem = error instanceof InventoryError ? error.message : "That plan could not be worked out.";
    }
  }
  const activeRecipes = recipes.filter((r) => r.active);
  const [rooms, playDecision] = await Promise.all([
    db.select({ id: locations.id, name: locations.name }).from(locations).where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId))).orderBy(asc(locations.name)),
    automationDecision(session.orgId, "PRODUCTION", session.facilityId),
  ]);
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
      {canWrite && activeRecipes.length > 0 ? (
        <div className="mb-6" data-testid="play-card">
          <Card title="Make a batch" action={<span className="text-sm text-slate-600">{playDecision.action === "BLOCKED" ? "Off" : "On"}</span>}>
            {playDecision.action === "BLOCKED" ? (
              <p className="text-sm text-slate-700">
                {playDecision.reason}{" "}
                <Link href="/settings/automation" className="font-semibold text-brand-700 hover:underline">
                  Automation settings
                </Link>
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-slate-600">
                  Pick a recipe and how many batches, then press Make it. It uses the oldest packages first, starts the run, adds every input, and in a practice facility finishes it with the planned amount. At a real licensed facility it stops before finishing so you can enter the real weight. If anything goes wrong it undoes itself.
                </p>
                <ActionForm action={playAction} submitLabel="Make it" className="flex flex-wrap items-end gap-3">
                  <Field label="Recipe">
                    <select name="recipeId" className={inputClass}>
                      {activeRecipes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Batches">
                    <input name="batches" inputMode="decimal" defaultValue="1" className={`${inputClass} w-24`} />
                  </Field>
                  <Field label="Finished product goes to">
                    <select name="locationId" defaultValue={(rooms.find((r) => /finished/i.test(r.name)) ?? rooms.find((r) => /vault/i.test(r.name)))?.id ?? ""} className={inputClass}>
                      <option value="">Choose a room</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </ActionForm>
              </div>
            )}
          </Card>
        </div>
      ) : null}
      {activeRecipes.length > 0 ? (
        <div className="mb-6">
          <Card title="Plan a multi-stage run">
            <p className="mb-3 text-sm text-slate-600">
              Pick the finished product and how many batches. Where one recipe uses another recipe&apos;s output (cones into boxed pre-rolls, say), this works out every stage, uses what you already have first, and adds up the raw materials.
            </p>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <Field label="Finished recipe">
                <select name="plan" defaultValue={planId ?? activeRecipes[0].id} className={inputClass}>
                  {activeRecipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Batches">
                <input name="batches" inputMode="decimal" defaultValue={planBatches ?? "1"} className={`${inputClass} w-28`} />
              </Field>
              <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50">
                Show plan
              </button>
            </form>
            {planProblem ? (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">
                {planProblem}
              </p>
            ) : null}
            {plan ? (
              <div className="mt-4 space-y-4 text-sm" data-testid="chain-plan">
                {plan.stages.length === 0 ? (
                  <p className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-900">Nothing to make: what you have in stock already covers it.</p>
                ) : (
                  <ol className="space-y-2">
                    {plan.stages.map((st, i) => {
                      const out = itemById.get(st.outputItemId);
                      return (
                        <li key={st.recipeId} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                          <p className="font-semibold text-slate-900">
                            Stage {i + 1}: {st.name}, {st.batches.toString()} batch{st.batches.eq(1) ? "" : "es"} → {st.plannedOutput.toString()} {out ? unitLabel(out.unit) : ""} of {out?.name ?? "output"}
                          </p>
                          <ul className="mt-1 list-disc pl-5 text-slate-700">
                            {st.inputs.map((inp) => {
                              const it = itemById.get(inp.itemId);
                              return (
                                <li key={inp.itemId}>
                                  {inp.quantity.toString()} {it ? unitLabel(it.unit) : ""} of {it?.name ?? "item"}
                                  {inp.fromStage ? <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">made in an earlier stage</span> : null}
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {plan.usedFromStock.length > 0 ? (
                  <p className="text-slate-700">
                    Already in stock and used first:{" "}
                    {plan.usedFromStock.map((u) => `${u.quantity.toString()} ${itemById.get(u.itemId) ? unitLabel(itemById.get(u.itemId)!.unit) : ""} of ${itemById.get(u.itemId)?.name ?? "item"}`).join(", ")}.
                  </p>
                ) : null}
                {plan.raw.length > 0 ? (
                  <div>
                    <h3 className="font-bold text-slate-900">Raw materials</h3>
                    <table className="mt-1 w-full text-left">
                      <thead className="text-xs uppercase text-slate-500">
                        <tr>
                          <th className="py-1 pr-3">Item</th>
                          <th className="py-1 pr-3">Needed</th>
                          <th className="py-1 pr-3">On hand</th>
                          <th className="py-1">Short</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {plan.raw.map((r) => {
                          const it = itemById.get(r.itemId);
                          return (
                            <tr key={r.itemId}>
                              <td className="py-1 pr-3 font-medium">{it?.name ?? "item"}</td>
                              <td className="py-1 pr-3">{r.needed.toString()} {it ? unitLabel(it.unit) : ""}</td>
                              <td className="py-1 pr-3">{r.onHand.toString()}</td>
                              <td className={`py-1 font-semibold ${r.short.gt(0) ? "text-red-700" : "text-emerald-700"}`}>{r.short.gt(0) ? r.short.toString() : "none"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {canWrite && plan.stages.length > 0 ? (
                  <ActionForm action={startChainAction} submitLabel={`Start all ${plan.stages.length} stage${plan.stages.length === 1 ? "" : "s"}`} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="recipeId" value={planId} />
                    <input type="hidden" name="batches" value={planBatches} />
                    <Field label="Base name for the runs">
                      <input name="baseName" required maxLength={70} defaultValue={suggestRunName([], new Date()).replace(/-\d+$/, "")} className={inputClass} />
                    </Field>
                  </ActionForm>
                ) : null}
              </div>
            ) : null}
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
                        {makers.has(line.itemId) && line.itemId !== recipe.outputItemId ? <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">made by another recipe</span> : null}
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
