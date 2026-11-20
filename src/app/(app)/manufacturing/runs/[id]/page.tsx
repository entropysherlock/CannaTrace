import Decimal from "decimal.js";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import Link from "next/link";
import { LabelLink } from "@/components/labels/label-link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ManufacturingTabs } from "@/components/manufacturing-tabs";
import { RunGuide } from "@/components/run-guide";
import { Card, PageHeader } from "@/components/ui";
import { bomLines, boms, items, locations, packages, productionInputs, productionRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { inputCost, weightLoss, yieldPercent } from "@/lib/manufacturing-math";
import { can } from "@/lib/rbac";
import { requireAnyPagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { removeInputAction } from "../../actions";
import { facilityZone } from "@/lib/time";

const money = (value: Decimal.Value) => `$${new Decimal(value).toFixed(2)}`;
const num = (value: Decimal.Value) => new Decimal(value).toString();

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAnyPagePermission("manufacturing.write", "audit.view");
  const zone = await facilityZone(session.facilityId);
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
  // Packages that can go into this run, so nobody has to know a tag: the recipe's items, active, with stock.
  const recipeItemIds = lines.map((l) => l.itemId);
  const stock = open && recipeItemIds.length
    ? await db
        .select({ tag: packages.tag, itemId: packages.itemId, quantity: packages.quantity, unit: packages.unit, lot: packages.lotNumber, itemName: items.name })
        .from(packages)
        .innerJoin(items, eq(items.id, packages.itemId))
        .where(and(eq(packages.orgId, session.orgId), eq(packages.facilityId, session.facilityId), eq(packages.status, "ACTIVE"), inArray(packages.itemId, recipeItemIds), gt(packages.quantity, "0")))
        .orderBy(asc(items.name), asc(packages.createdAt))
        .limit(300)
    : [];
  const canWrite = open && can(session, "manufacturing.write");
  const used = (itemId: string) => inputs.filter((i) => i.itemId === itemId).reduce((sum, i) => sum.add(i.quantity), new Decimal(0));
  const costSoFar = inputCost(inputs);
  const yieldPct = run.actualOutput ? yieldPercent(run.actualOutput, run.plannedOutput) : null;
  const loss = run.actualOutput ? weightLoss(inputs, { quantity: run.actualOutput, unit: row.unit }) : null;

  return (
    <>
      <PageHeader
        title={run.name}
        subtitle={`${row.recipeName} × ${num(run.batches)} · makes ${row.itemName} · started by ${run.userName} on ${run.createdAt.toLocaleDateString("en-US", { timeZone: zone })}`}
        action={
          output && can(session, "labels.print") ? (
            <div className="flex flex-wrap gap-2">
              <LabelLink kind="PACKAGE" ids={[output.id]}>
                Print package label
              </LabelLink>
              <LabelLink kind="PRODUCT" ids={[output.id]}>
                Print product label
              </LabelLink>
            </div>
          ) : null
        }
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
              <Link key={tile.label} href={tile.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
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
                      <span className={short.gt(0) ? "text-amber-700" : short.lt(0) ? "text-fuchsia-700" : "text-brand-700"}>
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
                      <Link href={`/inventory/${input.packageId}`} className="font-mono font-semibold text-brand-700 hover:underline">
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
                        <ActionForm action={removeInputAction} submitLabel="Remove" quiet className="flex flex-col items-end gap-1">
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
          <RunGuide
            runId={run.id}
            unit={unitLabel(row.unit)}
            planned={num(run.plannedOutput)}
            rooms={rooms}
            toGo={lines.filter((l) => new Decimal(l.quantity).mul(run.batches).toDecimalPlaces(4).sub(used(l.itemId)).gt(0)).length}
            inputCount={inputs.length}
            packages={stock.map((p) => {
              const line = lines.find((l) => l.itemId === p.itemId);
              const left = line ? new Decimal(line.quantity).mul(run.batches).sub(used(p.itemId)) : new Decimal(0);
              const suggest = left.gt(0) ? Decimal.min(left, p.quantity) : new Decimal(0);
              return { tag: p.tag, label: `${p.itemName} · ${p.tag} · ${num(p.quantity)} ${unitLabel(p.unit)}${p.lot ? ` · lot ${p.lot}` : ""}`, suggest: suggest.gt(0) ? num(suggest.toDecimalPlaces(4)) : "" };
            })}
            canCancel
          />
        ) : null}
      </div>
    </>
  );
}
