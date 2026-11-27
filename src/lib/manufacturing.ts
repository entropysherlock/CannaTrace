import Decimal from "decimal.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  bomLines,
  boms,
  items,
  packageLineage,
  packages,
  productionCosts,
  productionInputs,
  productionRuns,
  type Package,
  type ProductionRun,
} from "@/db/schema";
import { db, type Tx } from "./db";
import { findLoop, planChain, type ChainPlan, type ChainRecipe } from "./bom-tree";
import {
  InventoryError,
  audit,
  consumeFromPackageInTx,
  createPackageInTx,
  returnToPackageInTx,
  type Actor,
} from "./inventory";
import { normalizeTag, parsePositiveQty, storeCost } from "./inventory-math";
import { MAX_YIELD_PERCENT, NOTE_YIELD_PERCENT, inputCost, parseBatches, scaleRecipe, unitCost, yieldPercent } from "./manufacturing-math";

const store = (value: Decimal) => value.toFixed(4);

function requireText(value: string | null | undefined, message: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new InventoryError(message);
  return text.slice(0, 120);
}

/**
 * One input row's quantity, with a message that names the row and says what is wrong:
 * blank, typed with a unit ("35g"), or not a number. The unit always comes from the item.
 */
function recipeLineQty(raw: unknown, row: number): ReturnType<typeof parsePositiveQty> {
  const text = String(raw ?? "").trim();
  if (!text) throw new InventoryError(`Input row ${row} has an item but no quantity. Type how much one batch uses, for example 35.`);
  // "1,000" is a thousands separator, so it is safe to read as 1000.
  const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, "") : text;
  if (/^\d*\.?\d+\s*[a-zA-Z]+$/.test(plain)) {
    throw new InventoryError(`Input row ${row}: type just the number, for example ${plain.replace(/\s*[a-zA-Z]+$/, "")}, not "${text}". The unit comes from the item you picked.`);
  }
  if (!/^\d*\.?\d+$/.test(plain)) throw new InventoryError(`Input row ${row}: "${text}" isn't a number. Type it like 35 or 12.5.`);
  return parsePositiveQty(plain, `Input row ${row} quantity`);
}

/** Save a recipe (bill of materials): the inputs for one batch and how much one batch makes. */
export async function createRecipe(
  actor: Actor,
  input: { name: string; outputItemId: string; outputQuantity: unknown; lines: { itemId: string; quantity: unknown; row?: number }[] },
): Promise<{ id: string }> {
  const name = requireText(input.name, "Give the recipe a name.");
  const outputQuantity = parsePositiveQty(input.outputQuantity, "Output quantity");
  if (input.lines.length === 0) throw new InventoryError("Add at least one input to the recipe.");
  const lines = input.lines.map((line, i) => ({ itemId: line.itemId, quantity: recipeLineQty(line.quantity, line.row ?? i + 1) }));
  const ids = lines.map((l) => l.itemId);
  if (ids.some((id) => !id)) throw new InventoryError("Choose an item for every input row that has a quantity.");
  if (new Set(ids).size !== ids.length) throw new InventoryError("Each input item can only be listed once.");
  if (ids.includes(input.outputItemId)) throw new InventoryError("A recipe cannot use its own output as an input.");

  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.orgId, actor.orgId), eq(items.active, true), inArray(items.id, [...ids, input.outputItemId])));
    if (found.length !== ids.length + 1) throw new InventoryError("Pick every item from the list.");
    const [recipe] = await tx
      .insert(boms)
      .values({ orgId: actor.orgId, name, outputItemId: input.outputItemId, outputQuantity: store(outputQuantity) })
      .onConflictDoNothing({ target: [boms.orgId, boms.name] })
      .returning({ id: boms.id });
    if (!recipe) throw new InventoryError(`There is already a recipe called ${name}.`);
    await tx.insert(bomLines).values(lines.map((l) => ({ bomId: recipe.id, itemId: l.itemId, quantity: store(l.quantity) })));
    // A recipe that feeds itself through other recipes can never be made. Throwing rolls the save back.
    const loop = findLoop(await loadChainRecipes(actor.orgId, tx));
    if (loop) throw new InventoryError(`This recipe would make a circle with your other recipes (${loop.join(" → ")}). One of them has to start from something that is not made by the others.`);
    await audit(tx, actor, {
      entityType: "Recipe",
      entityId: recipe.id,
      action: "CREATE",
      after: { name, outputItemId: input.outputItemId, outputQuantity: outputQuantity.toString(), inputs: lines.length },
    });
    return recipe;
  });
}

export async function setRecipeActive(actor: Actor, input: { recipeId: string; active: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const [recipe] = await tx
      .update(boms)
      .set({ active: input.active })
      .where(and(eq(boms.id, input.recipeId), eq(boms.orgId, actor.orgId)))
      .returning({ id: boms.id });
    if (recipe) await audit(tx, actor, { entityType: "Recipe", entityId: recipe.id, action: input.active ? "REACTIVATE" : "RETIRE" });
  });
}

export async function startRun(
  actor: Actor,
  input: { name: string; recipeId: string; batches: unknown },
): Promise<ProductionRun> {
  const name = requireText(input.name, "Give the run a name or number, for example RUN-1116-A.");
  const batches = parseBatches(input.batches);
  return db.transaction(async (tx) => {
    const [recipe] = await tx
      .select()
      .from(boms)
      .where(and(eq(boms.id, input.recipeId), eq(boms.orgId, actor.orgId), eq(boms.active, true)));
    if (!recipe) throw new InventoryError("Pick a recipe from the list.");
    const { plannedOutput } = scaleRecipe({ outputQuantity: recipe.outputQuantity, lines: [] }, batches);
    const [run] = await tx
      .insert(productionRuns)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        name,
        bomId: recipe.id,
        outputItemId: recipe.outputItemId,
        batches: store(batches),
        plannedOutput: store(plannedOutput),
        userId: actor.userId,
        userName: actor.userName,
      })
      .onConflictDoNothing({ target: [productionRuns.facilityId, productionRuns.name] })
      .returning();
    if (!run) throw new InventoryError(`This facility already has a run called ${name}.`);
    await audit(tx, actor, {
      entityType: "ProductionRun",
      entityId: run.id,
      action: "START",
      after: { name, recipe: recipe.name, batches: batches.toString(), plannedOutput: plannedOutput.toString() },
    });
    return run;
  });
}

export async function lockOpenRun(tx: Tx, actor: Actor, runId: string): Promise<ProductionRun> {
  const [run] = await tx
    .select()
    .from(productionRuns)
    .where(and(eq(productionRuns.id, runId), eq(productionRuns.orgId, actor.orgId), eq(productionRuns.facilityId, actor.facilityId)))
    .for("update");
  if (!run) throw new InventoryError("That production run was not found at this facility.");
  if (run.status !== "IN_PROGRESS") throw new InventoryError(`This run is ${run.status.toLowerCase()} and can no longer be changed.`);
  return run;
}

/** Use product from a package in a run. The quantity leaves the package straight away. */
export async function addRunInput(
  actor: Actor,
  input: { runId: string; tag: string; quantity: unknown },
): Promise<{ tag: string; remaining: string }> {
  const tag = normalizeTag(input.tag);
  return db.transaction(async (tx) => {
    const run = await lockOpenRun(tx, actor, input.runId);
    const [source] = await tx
      .select({ id: packages.id, itemId: packages.itemId })
      .from(packages)
      .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.tag, tag)));
    if (!source) throw new InventoryError(`No package with tag ${tag} at this facility.`);
    const [line] = await tx
      .select({ itemId: bomLines.itemId })
      .from(bomLines)
      .where(and(eq(bomLines.bomId, run.bomId), eq(bomLines.itemId, source.itemId)));
    if (!line) throw new InventoryError(`Package ${tag} holds an item that is not in this run's recipe.`);

    const used = await consumeFromPackageInTx(tx, actor, {
      packageId: source.id,
      quantity: input.quantity,
      note: `Used in production run ${run.name}`,
    });
    await tx.insert(productionInputs).values({
      runId: run.id,
      packageId: source.id,
      itemId: source.itemId,
      quantity: store(used.quantity),
      unit: used.before.unit,
      costPerUnit: used.before.costPerUnit,
      userName: actor.userName,
    });
    await audit(tx, actor, {
      entityType: "ProductionRun",
      entityId: run.id,
      action: "ADD_INPUT",
      after: { tag, quantity: used.quantity.toString(), unit: used.before.unit },
    });
    return { tag, remaining: new Decimal(used.after.quantity).toString() };
  });
}

/** Undo an input: the quantity goes back into the package it came from. */
export async function removeRunInput(actor: Actor, input: { inputId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(productionInputs).where(eq(productionInputs.id, input.inputId));
    if (!row) throw new InventoryError("That input was already removed.");
    const run = await lockOpenRun(tx, actor, row.runId);
    const [deleted] = await tx.delete(productionInputs).where(eq(productionInputs.id, row.id)).returning({ id: productionInputs.id });
    if (!deleted) throw new InventoryError("That input was already removed.");
    const pkg = await returnToPackageInTx(tx, actor, {
      packageId: row.packageId,
      quantity: new Decimal(row.quantity),
      note: `Returned from production run ${run.name}`,
    });
    await audit(tx, actor, {
      entityType: "ProductionRun",
      entityId: run.id,
      action: "REMOVE_INPUT",
      after: { tag: pkg.tag, quantity: new Decimal(row.quantity).toString(), unit: row.unit },
    });
  });
}

/**
 * Guard against typos at Finish. Far above plan (over 1000%) is almost certainly extra zeros, so it is
 * refused; moderately above plan (over 120%) is allowed only with a note saying why.
 */
export function checkYield(actual: Decimal, planned: Decimal.Value, note?: string | null): void {
  const pct = yieldPercent(actual, planned);
  if (pct === null) return;
  if (pct.gt(MAX_YIELD_PERCENT)) {
    throw new InventoryError(`That is ${pct.toString()}% of the planned output. Check for an extra digit. If it is real, change the recipe's output so the plan matches.`);
  }
  if (pct.gt(NOTE_YIELD_PERCENT) && !note?.trim()) {
    throw new InventoryError(`That is ${pct.toString()}% of the planned output. Add a note saying why it came out above plan.`);
  }
}

/** Finish a run: create the output package, link it to its inputs, and work out the cost per unit. */
export async function completeRun(
  actor: Actor,
  input: {
    runId: string;
    outputTag: string;
    actualQuantity: unknown;
    locationId: string;
    extraCost?: unknown;
    lossNote?: string | null;
  },
): Promise<{ run: ProductionRun; output: Package }> {
  const actual = parsePositiveQty(input.actualQuantity, "Actual output");
  const extraText = String(input.extraCost ?? "").trim();
  const extra = extraText === "" || extraText === "0" ? new Decimal(0) : parsePositiveQty(extraText, "Labor and other cost");

  return db.transaction(async (tx) => {
    const run = await lockOpenRun(tx, actor, input.runId);
    checkYield(actual, run.plannedOutput, input.lossNote);
    const [lines, inputs] = await Promise.all([
      tx
        .select({ itemId: bomLines.itemId, itemName: items.name })
        .from(bomLines)
        .innerJoin(items, eq(items.id, bomLines.itemId))
        .where(eq(bomLines.bomId, run.bomId)),
      tx
        .select({
          packageId: productionInputs.packageId,
          itemId: productionInputs.itemId,
          quantity: productionInputs.quantity,
          costPerUnit: productionInputs.costPerUnit,
          lotNumber: packages.lotNumber,
        })
        .from(productionInputs)
        .innerJoin(packages, eq(packages.id, productionInputs.packageId))
        .where(eq(productionInputs.runId, run.id)),
    ]);
    if (inputs.length === 0) throw new InventoryError("Add the inputs that were used before completing the run.");
    const usedItems = new Set(inputs.map((i) => i.itemId));
    const missing = lines.filter((l) => !usedItems.has(l.itemId));
    if (missing.length) {
      throw new InventoryError(`Nothing has been recorded for ${missing.map((m) => m.itemName).join(", ")}. Add it, or use a different recipe.`);
    }

    const itemized = await tx.select({ amount: productionCosts.amount }).from(productionCosts).where(eq(productionCosts.runId, run.id));
    const extraTotal = itemized.reduce((sum, c) => sum.add(c.amount), extra);
    const cost = inputCost(inputs);
    const perUnit = unitCost(cost, extraTotal, actual);
    const lots = new Set(inputs.map((i) => i.lotNumber ?? ""));
    const lotNumber = lots.size === 1 && !lots.has("") ? [...lots][0] : run.name;

    const output = await createPackageInTx(tx, actor, {
      tag: input.outputTag,
      itemId: run.outputItemId,
      quantity: actual,
      locationId: input.locationId,
      lotNumber,
      costPerUnit: perUnit && perUnit.gt(0) ? perUnit.toString() : null,
      note: `Made in production run ${run.name}`,
      type: "CONVERT_IN",
      auditAction: "CREATED_BY_PRODUCTION",
      auditExtra: { run: run.name },
    });
    const parentIds = [...new Set(inputs.map((i) => i.packageId))];
    await tx.insert(packageLineage).values(parentIds.map((parentId) => ({ parentId, childId: output.id })));

    const [updated] = await tx
      .update(productionRuns)
      .set({
        status: "COMPLETED",
        actualOutput: store(actual),
        outputPackageId: output.id,
        inputCost: cost ? store(cost) : null,
        extraCost: store(extraTotal),
        costPerUnit: perUnit ? storeCost(perUnit) : null,
        lossNote: input.lossNote?.trim().slice(0, 500) || null,
        completedAt: new Date(),
      })
      .where(eq(productionRuns.id, run.id))
      .returning();
    await audit(tx, actor, {
      entityType: "ProductionRun",
      entityId: run.id,
      action: "COMPLETE",
      after: {
        outputTag: output.tag,
        plannedOutput: new Decimal(run.plannedOutput).toString(),
        actualOutput: actual.toString(),
        inputCost: cost?.toString() ?? null,
        costPerUnit: perUnit?.toString() ?? null,
      },
      reason: input.lossNote,
    });
    return { run: updated, output };
  });
}

/** Cancel a run that has nothing in it. Remove its inputs first so the product goes back to its packages. */
export async function cancelRun(actor: Actor, input: { runId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const run = await lockOpenRun(tx, actor, input.runId);
    const remaining = await tx.$count(productionInputs, eq(productionInputs.runId, run.id));
    if (remaining > 0) {
      throw new InventoryError("Remove this run's inputs first, so the product goes back into the packages it came from.");
    }
    await tx.update(productionRuns).set({ status: "CANCELLED", completedAt: new Date() }).where(eq(productionRuns.id, run.id));
    await audit(tx, actor, { entityType: "ProductionRun", entityId: run.id, action: "CANCEL" });
  });
}

/** Every active recipe with its inputs, in the shape the chain planner uses. */
export async function loadChainRecipes(orgId: string, reader: Pick<Tx, "select"> = db): Promise<ChainRecipe[]> {
  const recipes = await reader.select().from(boms).where(and(eq(boms.orgId, orgId), eq(boms.active, true))).orderBy(asc(boms.name));
  if (recipes.length === 0) return [];
  const lines = await reader.select().from(bomLines).where(inArray(bomLines.bomId, recipes.map((r) => r.id)));
  return recipes.map((r) => ({
    id: r.id,
    name: r.name,
    outputItemId: r.outputItemId,
    outputQuantity: r.outputQuantity,
    lines: lines.filter((l) => l.bomId === r.id).map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
  }));
}

/** What is on hand at a facility, by item: active packages only, in each item's own unit. */
export async function onHandByItem(orgId: string, facilityId: string): Promise<Map<string, Decimal>> {
  const rows = await db
    .select({ itemId: packages.itemId, total: sql<string>`sum(${packages.quantity})` })
    .from(packages)
    .where(and(eq(packages.orgId, orgId), eq(packages.facilityId, facilityId), eq(packages.status, "ACTIVE")))
    .groupBy(packages.itemId);
  return new Map(rows.map((r) => [r.itemId, new Decimal(r.total)]));
}

export async function planFor(actor: Actor, input: { recipeId: string; batches: unknown }): Promise<ChainPlan> {
  const batches = parseBatches(input.batches);
  return planChain(await loadChainRecipes(actor.orgId), input.recipeId, batches, await onHandByItem(actor.orgId, actor.facilityId));
}

/**
 * Start every stage of a multi-stage plan, earliest first, named BASE-1, BASE-2, ... If one stage can't
 * start, the ones already started are cancelled so nothing is left half set up.
 */
export async function startChain(actor: Actor, input: { recipeId: string; batches: unknown; baseName: string }): Promise<{ runIds: string[] }> {
  const baseName = requireText(input.baseName, "Give the runs a base name, for example RUN-1116.");
  const plan = await planFor(actor, input);
  if (plan.stages.length === 0) throw new InventoryError("Nothing needs to be made: what you have in stock already covers it.");
  const started: ProductionRun[] = [];
  try {
    for (const [i, stage] of plan.stages.entries()) {
      started.push(await startRun(actor, { name: `${baseName}-${i + 1}`, recipeId: stage.recipeId, batches: stage.batches.toString() }));
    }
  } catch (error) {
    for (const run of started) await cancelRun(actor, { runId: run.id }).catch(() => undefined);
    throw error;
  }
  return { runIds: started.map((r) => r.id) };
}
