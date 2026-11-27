import { and, eq } from "drizzle-orm";
import { productionCosts, productionRuns } from "@/db/schema";
import { db } from "./db";
import { InventoryError, audit, type Actor } from "./inventory";
import { lockOpenRun } from "./manufacturing";
import { parseCostAmount, parseCostKind } from "./run-costs-math";

/** Record a cost against an open run. It is added to the run's cost when the run is completed. */
export async function addRunCost(actor: Actor, input: { runId: string; kind: unknown; description: unknown; amount: unknown }): Promise<void> {
  const kind = parseCostKind(input.kind);
  const description = String(input.description ?? "").trim().slice(0, 200);
  if (!description) throw new InventoryError("Say what the cost was for.");
  const amount = parseCostAmount(input.amount);
  await db.transaction(async (tx) => {
    const run = await lockOpenRun(tx, actor, input.runId);
    const [row] = await tx.insert(productionCosts).values({ runId: run.id, kind, description, amount: amount.toFixed(4), userName: actor.userName }).returning();
    await audit(tx, actor, { entityType: "ProductionRun", entityId: run.id, action: "COST_ADDED", after: { kind, description, amount: amount.toString(), costId: row.id } });
  });
}

export async function removeRunCost(actor: Actor, input: { costId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [cost] = await tx.select().from(productionCosts).where(eq(productionCosts.id, input.costId));
    if (!cost) throw new InventoryError("That cost was not found.");
    const [owned] = await tx
      .select({ id: productionRuns.id })
      .from(productionRuns)
      .where(and(eq(productionRuns.id, cost.runId), eq(productionRuns.orgId, actor.orgId), eq(productionRuns.facilityId, actor.facilityId)));
    if (!owned) throw new InventoryError("That cost was not found.");
    const run = await lockOpenRun(tx, actor, cost.runId);
    await tx.delete(productionCosts).where(eq(productionCosts.id, cost.id));
    await audit(tx, actor, { entityType: "ProductionRun", entityId: run.id, action: "COST_REMOVED", before: { kind: cost.kind, description: cost.description, amount: cost.amount } });
  });
}
