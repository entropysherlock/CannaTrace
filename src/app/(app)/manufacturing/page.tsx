import Decimal from "decimal.js";
import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { boms, items, productionRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { yieldPercent } from "@/lib/manufacturing-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { startRunAction } from "./actions";

const STATUS_STYLE = { IN_PROGRESS: "text-amber-700", COMPLETED: "text-brand-700", CANCELLED: "text-slate-400" };

export default async function ManufacturingPage() {
  const session = await requirePagePermission("inventory.view");
  const [runs, recipes] = await Promise.all([
    db
      .select({ run: productionRuns, recipeName: boms.name, itemName: items.name, unit: items.unit })
      .from(productionRuns)
      .innerJoin(boms, eq(boms.id, productionRuns.bomId))
      .innerJoin(items, eq(items.id, productionRuns.outputItemId))
      .where(and(eq(productionRuns.orgId, session.orgId), eq(productionRuns.facilityId, session.facilityId)))
      .orderBy(desc(eq(productionRuns.status, "IN_PROGRESS")), desc(productionRuns.createdAt))
      .limit(100),
    db
      .select({ id: boms.id, name: boms.name })
      .from(boms)
      .where(and(eq(boms.orgId, session.orgId), eq(boms.active, true)))
      .orderBy(asc(boms.name)),
  ]);
  const canWrite = can(session, "manufacturing.write");

  return (
    <>
      <PageHeader title="Manufacturing" subtitle="Turn input packages into finished product, with yield and cost on every run." />
      <ManufacturingTabs current="/manufacturing" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {runs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
              No production runs yet. Save a recipe, then start a run.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {runs.map(({ run, recipeName, itemName, unit }) => {
                const yieldPct = run.actualOutput ? yieldPercent(run.actualOutput, run.plannedOutput) : null;
                return (
                  <li key={run.id}>
                    <Link href={`/manufacturing/runs/${run.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-brand-50">
                      <div>
                        <p className="font-semibold text-slate-900">{run.name}</p>
                        <p className="text-sm text-slate-600">
                          {recipeName} · makes {itemName}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className={`font-semibold ${STATUS_STYLE[run.status]}`}>{run.status.replace("_", " ").toLowerCase()}</p>
                        <p className="text-slate-600">
                          {run.actualOutput
                            ? `${new Decimal(run.actualOutput).toString()} ${unitLabel(unit)} made${yieldPct ? ` · ${yieldPct.toString()}% of plan` : ""}`
                            : `plan ${new Decimal(run.plannedOutput).toString()} ${unitLabel(unit)}`}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {canWrite ? (
          <Card title="Start a run">
            {recipes.length === 0 ? (
              <p className="text-sm text-slate-600">
                Save a recipe first on the{" "}
                <Link href="/manufacturing/recipes" className="font-semibold text-brand-700 hover:underline">
                  Recipes
                </Link>{" "}
                tab.
              </p>
            ) : (
              <ActionForm action={startRunAction} submitLabel="Start run">
                <Field label="Run name or number">
                  <input name="name" required className={inputClass} />
                </Field>
                <Field label="Recipe">
                  <select name="recipeId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a recipe
                    </option>
                    {recipes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="How many batches" hint="1 makes the recipe once. 2.5 makes it two and a half times.">
                  <input name="batches" inputMode="decimal" defaultValue="1" required className={inputClass} />
                </Field>
              </ActionForm>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
