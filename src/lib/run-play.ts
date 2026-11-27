import Decimal from "decimal.js";
import { and, asc, eq, gt, inArray, like } from "drizzle-orm";
import { boms, bomLines, items, locations, packages, productionInputs, productionRuns } from "@/db/schema";
import { automationDecision, recordActivity } from "./automation";
import { db } from "./db";
import { generateTags } from "./ids";
import { InventoryError, type Actor } from "./inventory";
import { addRunInput, cancelRun, completeRun, removeRunInput, startRun } from "./manufacturing";
import { parseBatches, scaleRecipe, suggestRunName } from "./manufacturing-math";
import { pickOldestFirst, type Pick, type Shortfall } from "./run-play-math";
import { facilityZone } from "./time";

export type PlayPlan = {
  recipeId: string;
  recipeName: string;
  outputItemName: string;
  outputUnit: string;
  batches: Decimal;
  plannedOutput: Decimal;
  picks: (Pick & { itemName: string })[];
  short: (Shortfall & { itemName: string })[];
};

/** What pressing Play would do for one recipe: the packages it would use, oldest first, and anything short. */
export async function buildPlay(actor: Actor, input: { recipeId: string; batches: unknown }): Promise<PlayPlan> {
  const batches = parseBatches(input.batches);
  const [recipe] = await db.select().from(boms).where(and(eq(boms.id, input.recipeId), eq(boms.orgId, actor.orgId), eq(boms.active, true)));
  if (!recipe) throw new InventoryError("Pick a recipe from the list.");
  const lines = await db.select({ itemId: bomLines.itemId, quantity: bomLines.quantity, name: items.name }).from(bomLines).innerJoin(items, eq(items.id, bomLines.itemId)).where(eq(bomLines.bomId, recipe.id));
  const [out] = await db.select({ name: items.name, unit: items.unit }).from(items).where(eq(items.id, recipe.outputItemId));
  const { plannedOutput, needs } = scaleRecipe({ outputQuantity: recipe.outputQuantity, lines }, batches);
  const stock = await db
    .select({ id: packages.id, tag: packages.tag, itemId: packages.itemId, quantity: packages.quantity, unit: packages.unit, createdAt: packages.createdAt })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.status, "ACTIVE"), gt(packages.quantity, "0"), inArray(packages.itemId, lines.map((l) => l.itemId))))
    .orderBy(asc(packages.createdAt));
  const name = new Map(lines.map((l) => [l.itemId, l.name]));
  const { picks, short } = pickOldestFirst(needs, stock);
  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    outputItemName: out?.name ?? "output",
    outputUnit: out?.unit ?? "",
    batches,
    plannedOutput,
    picks: picks.map((p) => ({ ...p, itemName: name.get(p.itemId) ?? "item" })),
    short: short.map((s) => ({ ...s, itemName: name.get(s.itemId) ?? "item" })),
  };
}

export type PlayResult = { runId: string; runName: string; completed: boolean; message: string };

/**
 * Start the run and add every input. If the setting is Auto and this is a practice facility, also finish it
 * using the planned amount. In a real facility it always stops before finishing: only the scale knows the yield.
 * If any step fails, what was done is undone so nothing is left half set up.
 */
export async function executePlay(actor: Actor, input: { recipeId: string; batches: unknown; locationId: string }): Promise<PlayResult> {
  const decision = await automationDecision(actor.orgId, "PRODUCTION", actor.facilityId);
  if (decision.action === "BLOCKED") {
    await recordActivity({ orgId: actor.orgId, facilityId: actor.facilityId, kind: "PRODUCTION", outcome: "BLOCKED", summary: `Play was blocked: ${decision.reason}`, trigger: "Play button", requestedBy: actor.userName });
    throw new InventoryError(`${decision.reason} Change it under Settings → Automation.`);
  }
  const plan = await buildPlay(actor, input);
  if (plan.short.length) throw new InventoryError(`Not enough stock: ${plan.short.map((s) => `${s.itemName} is short by ${s.short.toString()}`).join(", ")}.`);
  if (plan.picks.length === 0) throw new InventoryError("This recipe has no inputs to use.");
  const finishToo = decision.action === "AUTO";
  if (finishToo) {
    const [room] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, input.locationId), eq(locations.orgId, actor.orgId), eq(locations.facilityId, actor.facilityId)));
    if (!room) throw new InventoryError("Pick where the finished product goes.");
  }

  const zone = await facilityZone(actor.facilityId);
  const prefixDay = suggestRunName([], new Date(), zone).replace(/-\d+$/, "-");
  const taken = await db.select({ name: productionRuns.name }).from(productionRuns).where(and(eq(productionRuns.facilityId, actor.facilityId), like(productionRuns.name, `${prefixDay}%`)));
  const run = await startRun(actor, { name: suggestRunName(taken.map((t) => t.name), new Date(), zone), recipeId: plan.recipeId, batches: plan.batches.toString() });
  try {
    for (const pick of plan.picks) await addRunInput(actor, { runId: run.id, tag: pick.tag, quantity: pick.quantity.toString() });
    if (finishToo) {
      const [tag] = await generateTags(db, actor.orgId, "PACKAGE", 1);
      await completeRun(actor, { runId: run.id, outputTag: tag, actualQuantity: plan.plannedOutput.toString(), locationId: input.locationId, lossNote: "Finished automatically with the planned amount (practice facility)" });
    }
  } catch (error) {
    // Put everything back so no half-started run is left holding stock.
    const added = await db.select({ id: productionInputs.id }).from(productionInputs).where(eq(productionInputs.runId, run.id));
    for (const a of added) await removeRunInput(actor, { inputId: a.id }).catch(() => undefined);
    await cancelRun(actor, { runId: run.id }).catch(() => undefined);
    await recordActivity({ orgId: actor.orgId, facilityId: actor.facilityId, kind: "PRODUCTION", outcome: "FAILED", summary: `Play for ${plan.recipeName} failed and was undone: ${error instanceof Error ? error.message : "unknown error"}`, trigger: "Play button", requestedBy: actor.userName });
    throw error;
  }
  const message = finishToo
    ? `Ran ${plan.recipeName} ×${plan.batches.toString()} as ${run.name}: used ${plan.picks.length} package${plan.picks.length === 1 ? "" : "s"} and made ${plan.plannedOutput.toString()} of ${plan.outputItemName} (planned amount, practice facility).`
    : `Started ${run.name} for ${plan.recipeName} ×${plan.batches.toString()} and added ${plan.picks.length} input${plan.picks.length === 1 ? "" : "s"}. Enter how much you made to finish it.`;
  await recordActivity({ orgId: actor.orgId, facilityId: actor.facilityId, kind: "PRODUCTION", outcome: "DONE", summary: message, trigger: finishToo ? "Play button (Auto)" : "Play button (approved)", requestedBy: actor.userName });
  return { runId: run.id, runName: run.name, completed: finishToo, message };
}
