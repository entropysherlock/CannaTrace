import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { ScanInput } from "@/components/scan-input";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { bomLines, boms, items, locations, packages, productionInputs, productionRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { inputCost, weightLoss, yieldPercent } from "@/lib/manufacturing-math";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { addInputAction, cancelRunAction, completeRunAction, removeInputAction } from "../../actions";

const money = (value: Decimal.Value) => `$${new Decimal(value).toFixed(2)}`;
const num = (value: Decimal.Value) => new Decimal(value).toString();

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("inventory.view");
  const { id } = await params;
  const [row] = await db
    .select({ run: productionRuns, recipeName: boms.name, itemName: items.name, unit: items.unit })
    .from(productionRuns)
    .innerJoin(boms, eq(boms.id, productionRuns.bomId))
    .innerJoin(items, eq(items.id, productionRuns.outputItemId))
    .where(and(eq(productionRuns.id, id), eq(productionRuns.orgId, session.orgId), eq(productionRuns.facilityId, session.facilityId)));
  if (!row) notFound();
  const { run } = row;

  const [lines, inputs, rooms, [output]] = await Promise.all([
    db
      .select({ itemId: bomLines.itemId, quantity: bomLines.quantity, itemName: items.name, unit: items.unit })
      .from(bomLines)
      .innerJoin(items, eq(items.id, bomLines.itemId))
      .where(eq(bomLines.bomId, run.bomId))
      .orderBy(asc(items.name)),
    db
      .select({
        id: productionInputs.id,
        itemId: productionInputs.itemId,
        quantity: productionInputs.quantity,
        unit: productionInputs.unit,
        costPerUnit: productionInputs.costPerUnit,
        userName: productionInputs.userName,
        packageId: packages.id,
        tag: packages.tag,
        itemName: items.name,
      })
      .from(productionInputs)
      .innerJoin(packages, eq(packages.id, productionInputs.packageId))
      .innerJoin(items, eq(items.id, productionInputs.itemId))
      .where(eq(productionInputs.runId, run.id))
      .orderBy(asc(productionInputs.createdAt)),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
      .orderBy(asc(locations.name)),
    run.outputPackageId
      ? db.select({ id: packages.id, tag: packages.tag }).from(packages).where(eq(packages.id, run.outputPackageId))
      : Promise.resolve([]),
  ]);

  const open = run.status === "IN_PROGRESS";
  const canWrite = open && can(session.role, "manufacturing.write");
  const hidden = <input type="hidden" name="runId" value={run.id} />;
  const used = (itemId: string) => inputs.filter((i) => i.itemId === itemId).reduce((sum, i) => sum.add(i.quantity), new Decimal(0));
  const costSoFar = inputCost(inputs);
  const yieldPct = run.actualOutput ? yieldPercent(run.actualOutput, run.plannedOutput) : null;
  const loss = run.actualOutput ? weightLoss(inputs, { quantity: run.actualOutput, unit: row.unit }) : null;

  return (
    <>
      <PageHeader
        title={run.name}
        subtitle={`${row.recipeName} × ${num(run.batches)} · makes ${row.itemName} · started by ${run.userName} on ${run.createdAt.toLocaleDateString("en-US")}`}
      />
      <ManufacturingTabs current="/manufacturing" />

      {run.status === "COMPLETED" ? (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Made", value: `${num(run.actualOutput!)} ${unitLabel(row.unit)}`, sub: `plan was ${num(run.plannedOutput)}` },
            { label: "Yield", value: yieldPct ? `${yieldPct.toString()}%` : "n/a", sub: loss ? `${num(loss)} g lost by weight` : "of planned output" },
            {
              label: `Cost per ${unitLabel(row.unit)}`,
              value: run.costPerUnit ? money(run.costPerUnit) : "Unknown",
              sub: run.costPerUnit ? `inputs ${money(run.inputCost!)} + other ${money(run.extraCost ?? 0)}` : "an input had no cost on record",
            },
            { label: "Output package", value: output?.tag ?? "", sub: "open in inventory", href: output ? `/inventory/${output.id}` : undefined },
          ].map((tile) => {
            const body = (
              <>
                <p className="text-sm text-slate-600">{tile.label}</p>
                <p className="mt-1 break-all text-2xl font-bold text-slate-900">{tile.value}</p>
                <p className="text-sm text-slate-500">{tile.sub}</p>
              </>
            );
            return tile.href ? (
              <Link key={tile.label} href={tile.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-500">
                {body}
              </Link>
            ) : (
              <div key={tile.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                {body}
              </div>
            );
          })}
        </div>
      ) : null}
      {run.status === "CANCELLED" ? (
        <p className="mb-5 rounded-lg border border-slate-300 bg-slate-100 p-4 text-sm text-slate-700">This run was cancelled. Nothing was used or made.</p>
      ) : null}
      {run.lossNote ? <p className="mb-5 text-sm text-slate-700">Note: {run.lossNote}</p> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="What the recipe calls for">
            <ul className="divide-y divide-slate-100 text-sm">
              {lines.map((line) => {
                const need = new Decimal(line.quantity).mul(run.batches).toDecimalPlaces(4);
                const have = used(line.itemId);
                const short = need.sub(have);
                return (
                  <li key={line.itemId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium text-slate-900">{line.itemName}</span>
                    <span className="text-right">
                      <span className="font-semibold">
                        {num(have)} of {num(need)} {unitLabel(line.unit)}
                      </span>{" "}
                      <span className={short.gt(0) ? "text-amber-700" : short.lt(0) ? "text-fuchsia-700" : "text-emerald-700"}>
                        {short.gt(0) ? `· ${num(short)} to go` : short.lt(0) ? `· ${num(short.abs())} over` : "· done"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Inputs used" action={<span className="text-sm text-slate-600">{costSoFar ? `${money(costSoFar)} ${open ? "so far" : "total"}` : inputs.length ? "cost unknown" : ""}</span>}>
            {inputs.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing added yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {inputs.map((input) => (
                  <li key={input.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div>
                      <Link href={`/inventory/${input.packageId}`} className="font-mono font-semibold text-emerald-700 hover:underline">
                        {input.tag}
                      </Link>{" "}
                      <span className="text-slate-600">
                        · {input.itemName} · {input.userName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-right">
                        <span className="font-semibold">
                          {num(input.quantity)} {unitLabel(input.unit)}
                        </span>
                        <span className="block text-slate-500">
                          {input.costPerUnit ? money(new Decimal(input.quantity).mul(input.costPerUnit)) : "no cost on record"}
                        </span>
                      </span>
                      {canWrite ? (
                        <ActionForm action={removeInputAction} submitLabel="Remove" className="flex flex-col items-end gap-1">
                          <input type="hidden" name="inputId" value={input.id} />
                        </ActionForm>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {canWrite ? (
          <div className="space-y-5">
            <Card title="Add an input">
              <ActionForm action={addInputAction} submitLabel="Add to run">
                {hidden}
                <Field label="Package tag">
                  <ScanInput name="tag" required />
                </Field>
                <Field label="Quantity used" hint="In the package's unit. It leaves the package right away.">
                  <input name="quantity" inputMode="decimal" required className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
            <Card title="Complete the run">
              <ActionForm action={completeRunAction} submitLabel="Complete run">
                {hidden}
                <Field label="Tag for the finished package">
                  <ScanInput name="outputTag" required />
                </Field>
                <Field label={`How much was made (${unitLabel(row.unit)})`} hint={`The plan was ${num(run.plannedOutput)}.`}>
                  <input name="actualQuantity" inputMode="decimal" required className={inputClass} />
                </Field>
                <Field label="Put away to">
                  <select name="locationId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a location
                    </option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Labor and other cost, in dollars (optional)" hint="Added to the input cost before working out cost per unit.">
                  <input name="extraCost" inputMode="decimal" className={inputClass} />
                </Field>
                <Field label="Note on loss or problems (optional)">
                  <input name="lossNote" maxLength={500} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
            <Card title="Cancel the run">
              <ActionForm action={cancelRunAction} submitLabel="Cancel run">
                {hidden}
                <p className="text-sm text-slate-600">Only an empty run can be cancelled. Remove its inputs first so the product goes back.</p>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
