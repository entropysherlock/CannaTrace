import { and, asc, eq } from "drizzle-orm";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { Card, PageHeader, inputClass } from "@/components/ui";
import { items } from "@/db/schema";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import { loadChainRecipes, onHandByItem } from "@/lib/manufacturing";
import { planDemand, type Demand } from "@/lib/mrp";
import { requireAnyPagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";

export const metadata = { title: "Planning · Leaf2Sale" };
const ROWS = 5;

export default async function PlanningPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireAnyPagePermission("manufacturing.write", "audit.view");
  const q = await searchParams;
  const [recipes, itemRows, onHand] = await Promise.all([
    loadChainRecipes(session.orgId),
    db.select({ id: items.id, name: items.name, unit: items.unit }).from(items).where(and(eq(items.orgId, session.orgId))).orderBy(asc(items.name)),
    onHandByItem(session.orgId, session.facilityId),
  ]);
  const itemById = new Map(itemRows.map((i) => [i.id, i]));
  const wanted: Demand[] = [];
  for (let n = 1; n <= ROWS; n++) {
    const id = q[`r${n}`];
    const batches = q[`b${n}`]?.trim();
    if (id && batches) wanted.push({ recipeId: id, batches });
  }
  let plan: ReturnType<typeof planDemand> | null = null;
  let problem: string | null = null;
  if (wanted.length) {
    try {
      plan = planDemand(recipes, wanted, onHand);
    } catch (error) {
      problem = error instanceof InventoryError ? error.message : "That plan could not be worked out. Check the batch numbers.";
    }
  }
  const unit = (id: string) => (itemById.get(id) ? unitLabel(itemById.get(id)!.unit) : "");
  const name = (id: string) => itemById.get(id)?.name ?? "item";
  const toBuy = plan?.raw.filter((r) => r.short.gt(0)) ?? [];

  return (
    <>
      <PageHeader title="Planning" subtitle="Pick what you want to make. See every stage, the materials it takes, and what you are short of." />
      <ManufacturingTabs current="/manufacturing/planning" />
      {recipes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">Add a recipe first, then plan what to make from it.</p>
      ) : (
        <form method="get" className="mb-5 space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          {Array.from({ length: ROWS }, (_, i) => i + 1).map((n) => (
            <div key={n} className="flex flex-wrap items-center gap-2">
              <select name={`r${n}`} aria-label={`Recipe ${n}`} defaultValue={q[`r${n}`] ?? ""} className={`${inputClass} min-w-56 flex-1`}>
                <option value="">{n === 1 ? "Choose a recipe" : "Another recipe (optional)"}</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input name={`b${n}`} aria-label={`Batches ${n}`} inputMode="decimal" placeholder="Batches" defaultValue={q[`b${n}`] ?? ""} className={`${inputClass} w-28`} />
            </div>
          ))}
          <button type="submit" className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">
            Work out the plan
          </button>
        </form>
      )}
      {problem ? <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{problem}</p> : null}
      {plan ? (
        <div className="space-y-5" data-testid="mrp-plan">
          <Card title={toBuy.length ? "What to buy" : "Materials"}>
            {toBuy.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
                {plan.raw.length ? "You have everything on hand for this plan." : "Nothing more is needed: stock already covers it."}
              </p>
            ) : (
              <ul className="space-y-1 text-sm font-semibold text-red-800">
                {toBuy.map((r) => (
                  <li key={r.itemId}>
                    {name(r.itemId)}: {r.short.toString()} {unit(r.itemId)} short
                  </li>
                ))}
              </ul>
            )}
            {plan.raw.length > 0 ? (
              <table className="mt-4 w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Item</th>
                    <th className="py-1 pr-3">Needed</th>
                    <th className="py-1 pr-3">On hand</th>
                    <th className="py-1">Short</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.raw.map((r) => (
                    <tr key={r.itemId}>
                      <td className="py-1 pr-3 font-medium">{name(r.itemId)}</td>
                      <td className="py-1 pr-3">{r.needed.toString()} {unit(r.itemId)}</td>
                      <td className="py-1 pr-3">{r.onHand.toString()}</td>
                      <td className={`py-1 font-semibold ${r.short.gt(0) ? "text-red-700" : "text-emerald-700"}`}>{r.short.gt(0) ? r.short.toString() : "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Card>
          <Card title={`Runs to make, in order (${plan.stages.length})`}>
            {plan.stages.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing to make.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {plan.stages.map((st, i) => (
                  <li key={st.recipeId} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="font-semibold">
                      {i + 1}. {st.name}, {st.batches.toString()} batch{st.batches.eq(1) ? "" : "es"} → {st.plannedOutput.toString()} {unit(st.outputItemId)} of {name(st.outputItemId)}
                    </p>
                    <p className="text-slate-600">
                      Uses {st.inputs.map((inp) => `${inp.quantity.toString()} ${unit(inp.itemId)} ${name(inp.itemId)}${inp.fromStage ? " (made earlier)" : ""}`).join(", ")}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {plan.usedFromStock.length > 0 ? (
              <p className="mt-3 text-sm text-slate-700">Already in stock and used first: {plan.usedFromStock.map((u) => `${u.quantity.toString()} ${unit(u.itemId)} ${name(u.itemId)}`).join(", ")}.</p>
            ) : null}
            <p className="mt-3 text-xs text-slate-500">Start each run from the Recipes tab. Counts use what is on hand at this facility now; nothing is reserved.</p>
          </Card>
        </div>
      ) : null}
    </>
  );
}
