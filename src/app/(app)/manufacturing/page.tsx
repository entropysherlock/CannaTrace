import Decimal from "decimal.js";
import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { CheckCircle2, CircleDollarSign, Factory, FlaskConical, Gauge, Plus, Search, X, type LucideIcon } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { Card, Field, PageHeader, ScrollBox, buttonLinkClass, inputClass } from "@/components/ui";
import { boms, items, productionRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { suggestRunName, summarizeRuns, yieldPercent } from "@/lib/manufacturing-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { startRunAction } from "./actions";

const STATUSES = [
  { key: "", label: "All" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "COMPLETED", label: "Completed" },
  { key: "CANCELLED", label: "Cancelled" },
] as const;

const BADGE = {
  IN_PROGRESS: "bg-amber-100 text-amber-900 ring-amber-200",
  COMPLETED: "bg-brand-50 text-brand-800 ring-brand-200",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-200",
};

const num = (v: Decimal.Value) => new Decimal(v).toString();
const money = (v: Decimal.Value) => `$${new Decimal(v).toNumber().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" });

function Tile({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm sm:p-5">
      <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 sm:flex">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-extrabold tracking-tight text-brand-950 sm:text-3xl">{value}</span>
        <span className="block text-sm font-semibold text-slate-700">{label}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </div>
  );
}

/** The link for a filter or search, keeping the other one. */
function href(status: string, q: string, extra = "") {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (q) p.set("q", q);
  if (extra) p.set(extra, "1");
  const s = p.toString();
  return `/manufacturing${s ? `?${s}` : ""}`;
}

export default async function ManufacturingPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; new?: string }> }) {
  const session = await requirePagePermission("inventory.view");
  const params = await searchParams;
  const status = STATUSES.some((s) => s.key === params.status) ? (params.status as string) : "";
  const q = (params.q ?? "").trim().slice(0, 80);
  const canWrite = can(session, "manufacturing.write");

  const [runs, recipes] = await Promise.all([
    db
      .select({ run: productionRuns, recipeName: boms.name, itemName: items.name, unit: items.unit })
      .from(productionRuns)
      .innerJoin(boms, eq(boms.id, productionRuns.bomId))
      .innerJoin(items, eq(items.id, productionRuns.outputItemId))
      .where(and(eq(productionRuns.orgId, session.orgId), eq(productionRuns.facilityId, session.facilityId)))
      .orderBy(desc(eq(productionRuns.status, "IN_PROGRESS")), desc(productionRuns.createdAt))
      .limit(500),
    db
      .select({ id: boms.id, name: boms.name, outputQuantity: boms.outputQuantity, itemName: items.name, unit: items.unit })
      .from(boms)
      .innerJoin(items, eq(items.id, boms.outputItemId))
      .where(and(eq(boms.orgId, session.orgId), eq(boms.active, true)))
      .orderBy(asc(boms.name)),
  ]);

  const stats = summarizeRuns(runs.map((r) => r.run));
  const counts = Object.fromEntries(STATUSES.map((s) => [s.key, s.key ? runs.filter((r) => r.run.status === s.key).length : runs.length]));
  const needle = q.toLowerCase();
  const shown = runs.filter(
    ({ run, recipeName, itemName }) =>
      (!status || run.status === status) && (!needle || [run.name, recipeName, itemName].some((t) => t.toLowerCase().includes(needle))),
  );
  const showForm = canWrite && recipes.length > 0 && (params.new === "1" || runs.length === 0);

  return (
    <>
      <PageHeader
        title="Manufacturing"
        subtitle="Turn input packages into finished product, with yield and cost on every run."
        action={
          canWrite && recipes.length > 0 && !showForm ? (
            <Link href={`${href(status, q, "new")}#new-run`} className={buttonLinkClass} data-testid="new-run">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New run
            </Link>
          ) : null
        }
      />
      <ManufacturingTabs current="/manufacturing" />

      <section aria-label="Production at a glance" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-testid="mfg-stats">
        <Tile icon={Factory} label="In progress" value={String(stats.inProgress)} sub={stats.inProgress === 1 ? "run open now" : "runs open now"} />
        <Tile icon={CheckCircle2} label="Done this month" value={String(stats.completedThisMonth)} sub={stats.completedThisMonth === 1 ? "run finished" : "runs finished"} />
        <Tile
          icon={Gauge}
          label="Average yield"
          value={stats.averageYield ? `${stats.averageYield.toString()}%` : "—"}
          sub={stats.yieldRuns ? `of plan, last ${stats.yieldRuns} run${stats.yieldRuns === 1 ? "" : "s"} (90 days)` : "finish a run to see it"}
        />
        <Tile icon={CircleDollarSign} label="Cost this month" value={stats.costThisMonth ? money(stats.costThisMonth) : "—"} sub="inputs plus other costs, runs done" />
      </section>

      {showForm ? (
        <div id="new-run" className="mb-6 scroll-mt-4">
          <Card
            title="Start a new run"
            action={
              runs.length > 0 ? (
                <Link href={href(status, q)} className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                  <X className="h-4 w-4" aria-hidden="true" />
                  Close
                </Link>
              ) : null
            }
          >
            <ActionForm action={startRunAction} submitLabel="Start run">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Run name or number" hint="Suggested for today. Change it to your own batch number if you have one.">
                  <input name="name" required maxLength={80} defaultValue={suggestRunName(runs.map((r) => r.run.name))} className={inputClass} />
                </Field>
                <Field label="Recipe">
                  <select name="recipeId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a recipe
                    </option>
                    {recipes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} (one batch makes {num(r.outputQuantity)} {unitLabel(r.unit)})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="How many batches" hint="1 makes the recipe once. 2.5 makes it two and a half times.">
                  <input name="batches" inputMode="decimal" defaultValue="1" required className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}

      {runs.length === 0 && !showForm ? (
        <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-brand-200 bg-white px-6 py-12 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <FlaskConical className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-brand-950">No production runs yet</h2>
          <p className="mt-1 text-sm text-slate-600">
            {recipes.length === 0
              ? "Start with a recipe: what one batch uses and how much it makes. Then start a run from it."
              : "Pick a recipe and start your first run."}
          </p>
          {canWrite && recipes.length === 0 ? (
            <Link href="/manufacturing/recipes" className={`${buttonLinkClass} mt-5`}>
              Create a recipe
            </Link>
          ) : null}
        </div>
      ) : runs.length > 0 ? (
        <section aria-label="Production runs" className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 bg-brand-50/50 px-4 py-3">
            <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <Link
                  key={s.key}
                  href={href(s.key, q)}
                  aria-current={s.key === status ? "page" : undefined}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition ${
                    s.key === status ? "bg-brand-600 text-white" : "bg-white text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"
                  }`}
                >
                  {s.label}
                  <span className={`rounded-full px-1.5 text-xs ${s.key === status ? "bg-white/20" : "bg-brand-50"}`}>{counts[s.key]}</span>
                </Link>
              ))}
            </nav>
            <form action="/manufacturing" className="flex w-full items-center gap-2 sm:w-auto" role="search">
              {status ? <input type="hidden" name="status" value={status} /> : null}
              <label className="relative w-full sm:w-64">
                <span className="sr-only">Search runs</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input name="q" defaultValue={q} placeholder="Search runs" className={`${inputClass} pl-9`} />
              </label>
            </form>
          </div>

          {shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-600">
              No runs match{q ? ` "${q}"` : ""}.{" "}
              <Link href="/manufacturing" className="font-semibold text-brand-700 hover:underline">
                Show all runs
              </Link>
            </p>
          ) : (
            <ScrollBox label="Production runs list" size="lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white text-left text-xs font-bold uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
                  <tr>
                    <th className="px-4 py-3">Run</th>
                    <th className="hidden px-4 py-3 md:table-cell">Status</th>
                    <th className="px-4 py-3 text-right">Output</th>
                    <th className="hidden px-4 py-3 text-right sm:table-cell">Yield</th>
                    <th className="hidden px-4 py-3 text-right lg:table-cell">Cost / unit</th>
                    <th className="hidden px-4 py-3 text-right lg:table-cell">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map(({ run, recipeName, itemName, unit }) => {
                    const y = run.actualOutput ? yieldPercent(run.actualOutput, run.plannedOutput) : null;
                    const link = `/manufacturing/runs/${run.id}`;
                    return (
                      <tr key={run.id} className="group hover:bg-brand-50/60" data-testid="run-row">
                        <td className="px-4 py-3">
                          <Link href={link} className="font-bold text-brand-900 group-hover:underline">
                            {run.name}
                          </Link>
                          <p className="text-slate-600">
                            {itemName} <span className="text-slate-400">· {recipeName}</span>
                          </p>
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ring-1 md:hidden ${BADGE[run.status]}`}>
                            {run.status.replace("_", " ").toLowerCase()}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ${BADGE[run.status]}`}>
                            {run.status.replace("_", " ").toLowerCase()}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {run.actualOutput ? (
                            <>
                              <span className="font-semibold text-slate-900">
                                {num(run.actualOutput)} {unitLabel(unit)}
                              </span>
                              <span className="block text-xs text-slate-500">plan {num(run.plannedOutput)}</span>
                            </>
                          ) : (
                            <span className="text-slate-600">
                              plan {num(run.plannedOutput)} {unitLabel(unit)}
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-right sm:table-cell">
                          {y ? (
                            <span className={`font-semibold ${y.gte(95) ? "text-brand-700" : y.gte(85) ? "text-amber-700" : "text-red-700"}`}>{y.toString()}%</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-right lg:table-cell">
                          {run.costPerUnit ? <span className="font-semibold text-slate-900">{money(run.costPerUnit)}</span> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-right text-slate-600 lg:table-cell">
                          {day(run.createdAt)}
                          <span className="block text-xs text-slate-500">{run.userName}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollBox>
          )}
        </section>
      ) : null}
    </>
  );
}
