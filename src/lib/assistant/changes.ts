import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { auditLogs, orderLines, orders, packages, printJobs, productionInputs, tallyChanges, type TallyChange } from "@/db/schema";
import { recordingAudits } from "@/lib/audit-recorder";
import { restoreItem } from "@/lib/bulk-items";
import { changePlantPhase, movePlants, reopenHarvest, restoreDryWeight, reverseHarvestPackage, reverseHarvestWaste, untagPlants } from "@/lib/cultivation";
import { atomically, db, dryRun } from "@/lib/db";
import { cancelOrder, removeOrderLine, updateDestinations, updateVendors } from "@/lib/distribution";
import { adjustPackage, movePackage, setPackageStatus, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { markJob } from "@/lib/labels/service";
import { cancelRun, removeRunInput } from "@/lib/manufacturing";
import { currentZone } from "@/lib/time";

/**
 * Every change Tally makes after a Confirm is recorded here with the audit entries it wrote.
 * Undo reads those entries newest-first and writes the opposite change for each, through the
 * same inventory functions and checks as the screens. Nothing is erased: the original entries
 * stay, and the undo adds its own entries (and state reports) on top.
 */

type Json = Record<string, unknown>;
type Entry = { id: string; entityType: string; entityId: string; action: string; before: Json | null; after: Json | null; createdAt: Date };
type Step = { what: string; run: (actor: Actor, reason: string) => Promise<void> } | null;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * The opposite of one audit entry, or null when the entry is reversed by another one in the same
 * change (for example, cancelling an order also clears its lines). Throws when it can't be reversed.
 */
function inverse(e: Entry, all: Entry[]): Step {
  const a = e.after ?? {};
  const b = e.before ?? {};
  const has = (type: string, action: string, id = e.entityId) => all.some((x) => x.entityType === type && x.action === action && x.entityId === id);
  const tag = str(a.tag ?? b.tag);
  switch (`${e.entityType}:${e.action}`) {
    case "Package:RECEIVE":
    case "Package:CREATED_FROM_HARVEST":
    case "Package:CREATED_BY_PRODUCTION":
      return {
        what: `Empty package ${tag} (entry error)`,
        run: async (actor, reason) => {
          const [pkg] = await db.select({ quantity: packages.quantity, status: packages.status }).from(packages).where(eq(packages.id, e.entityId));
          if (!pkg || pkg.status === "FINISHED" || new Decimal(pkg.quantity).isZero()) return;
          await adjustPackage(actor, { packageId: e.entityId, newQuantity: "0", reasonCode: "ENTRY_ERROR", note: reason });
        },
      };
    case "Package:MOVE":
      if (!b.locationId) throw new InventoryError(`Package ${tag} had no location before it was moved, so the move can't be undone. Move it by hand.`);
      return { what: `Move package ${tag} back`, run: (actor, reason) => movePackage(actor, { packageId: e.entityId, toLocationId: str(b.locationId), note: reason }).then(() => undefined) };
    case "Package:ADJUST":
      return {
        what: `Set package ${tag} back to ${new Decimal(str(b.quantity) || "0").toString()}`,
        run: (actor, reason) =>
          adjustPackage(actor, { packageId: e.entityId, newQuantity: str(b.quantity), reasonCode: "ENTRY_ERROR", note: reason, reopenAs: (str(b.status) || "ACTIVE") as "ACTIVE" }).then(() => undefined),
      };
    case "Package:ON_HOLD":
    case "Package:QUARANTINE":
    case "Package:RELEASE": {
      const was = str(b.status);
      if (!["ACTIVE", "ON_HOLD", "QUARANTINE"].includes(was)) throw new InventoryError(`Package ${tag} was ${was.toLowerCase()} before, which Undo can't restore.`);
      return { what: `Set package ${tag} back to ${was.replace("_", " ").toLowerCase()}`, run: (actor, reason) => setPackageStatus(actor, { packageId: e.entityId, status: was, reason }).then(() => undefined) };
    }
    case "Package:USED_IN_PRODUCTION":
    case "Package:RETURNED_FROM_PRODUCTION":
      // Undone through the run's input (below), which puts the product back.
      if (all.some((x) => x.entityType === "ProductionRun" && (x.action === "ADD_INPUT" || x.action === "REMOVE_INPUT"))) return null;
      break;
    case "Package:SPLIT":
    case "Package:CREATED_BY_SPLIT":
      break;
    case "ProductionRun:START":
      return { what: `Cancel production run ${str(a.name)}`, run: (actor) => cancelRun(actor, { runId: e.entityId }) };
    case "ProductionRun:ADD_INPUT":
      return {
        what: `Return ${new Decimal(str(a.quantity) || "0").toString()} to package ${str(a.tag)}`,
        run: async (actor) => {
          const [input] = await db
            .select({ id: productionInputs.id })
            .from(productionInputs)
            .innerJoin(packages, eq(packages.id, productionInputs.packageId))
            .where(and(eq(productionInputs.runId, e.entityId), eq(packages.tag, str(a.tag)), eq(productionInputs.quantity, new Decimal(str(a.quantity)).toFixed(4))))
            .limit(1);
          if (!input) throw new InventoryError(`Package ${str(a.tag)} is no longer an input of that run.`);
          await removeRunInput(actor, { inputId: input.id });
        },
      };
    case "Order:CREATE":
      return { what: `Cancel order ${str(a.number)}`, run: (actor) => cancelOrder(actor, { orderId: e.entityId }) };
    case "Order:ADD_LINE":
    case "Order:CONFIRM":
      if (has("Order", "CREATE")) return null; // cancelling the order covers it
      if (e.action === "ADD_LINE")
        return {
          what: `Remove ${str(a.item)} from the order`,
          run: async (actor) => {
            const [line] = await db
              .select({ id: orderLines.id, status: orders.status })
              .from(orderLines)
              .innerJoin(orders, eq(orders.id, orderLines.orderId))
              .where(and(eq(orderLines.orderId, e.entityId), sql`${orderLines.itemId} in (select id from items where name = ${str(a.item)} and org_id = ${actor.orgId})`));
            if (!line) return;
            await removeOrderLine(actor, { lineId: line.id });
          },
        };
      break;
    case "PlantBatch:TAG_PLANTS": {
      const tags = Array.isArray(a.tags) ? (a.tags as unknown[]).map(str) : [];
      if (!tags.length) throw new InventoryError("This tagging was recorded before Undo could take it back. Remove the tags by hand.");
      return { what: `Take back the ${tags.length} new plant tag${tags.length === 1 ? "" : "s"}`, run: (actor) => untagPlants(actor, { batchId: e.entityId, tags }).then(() => undefined) };
    }
    case "Plant:PHASE_CHANGE":
      return { what: `Set plant ${tag} back to ${str(b.phase).toLowerCase()}`, run: (actor) => changePlantPhase(actor, { plantIds: [e.entityId], phase: str(b.phase), restoreChangedAt: b.phaseChangedAt ? new Date(str(b.phaseChangedAt)) : null }).then(() => undefined) };
    case "Plant:MOVE":
      if (!b.locationId) throw new InventoryError(`Plant ${tag} had no room before it was moved, so the move can't be undone. Move it by hand.`);
      return { what: `Move plant ${tag} back`, run: (actor) => movePlants(actor, { plantIds: [e.entityId], locationId: str(b.locationId) }).then(() => undefined) };
    case "Harvest:DRY_WEIGHT":
      return {
        what: b.dryWeightGrams === null || b.dryWeightGrams === undefined ? "Clear the harvest's dry weight" : `Set the dry weight back to ${new Decimal(str(b.dryWeightGrams)).toString()} g`,
        run: (actor, reason) => restoreDryWeight(actor, { harvestId: e.entityId, dryWeightGrams: b.dryWeightGrams == null ? null : str(b.dryWeightGrams), reason }),
      };
    case "Harvest:WASTE":
      return { what: `Take back ${str(a.wasteGrams)} g of waste`, run: (actor, reason) => reverseHarvestWaste(actor, { harvestId: e.entityId, grams: str(a.wasteGrams), reason }) };
    case "Harvest:PACKAGE":
      return {
        what: `Return ${str(a.grams)} g from ${str(a.packageTag)} to the harvest`,
        run: (actor, reason) => reverseHarvestPackage(actor, { harvestId: e.entityId, packageTag: str(a.packageTag), grams: str(a.grams), reason }),
      };
    case "Harvest:FINISH":
      return { what: "Reopen the harvest", run: (actor, reason) => reopenHarvest(actor, { harvestId: e.entityId, reason }) };
    case "Item:UPDATE":
      return { what: "Put the item back as it was", run: (actor, reason) => restoreItem(actor, e.entityId, b, reason) };
    case "Vendor:UPDATE":
      return { what: "Put the vendor back as it was", run: (actor) => updateVendors(actor, [e.entityId], b).then(() => undefined) };
    case "Destination:UPDATE":
      return { what: "Put the destination back as it was", run: (actor) => updateDestinations(actor, [e.entityId], b).then(() => undefined) };
    case "print_job:labels.print_requested":
      return {
        what: "Cancel the label print job",
        run: async (actor, reason) => {
          const [job] = await db.select({ status: printJobs.status }).from(printJobs).where(eq(printJobs.id, e.entityId));
          if (!job || job.status === "CANCELLED" || job.status === "PRINTED") return;
          await markJob(actor, e.entityId, "CANCELLED", reason);
        },
      };
  }
  throw new InventoryError(`Undo can't reverse "${e.action.toLowerCase().replaceAll("_", " ")}" on a ${e.entityType.toLowerCase()}. Fix it by hand on its page.`);
}

/** The reversal steps for a change, newest first. Throws if any part can't be reversed. */
function plan(entries: Entry[]): { what: string; run: (actor: Actor, reason: string) => Promise<void> }[] {
  return [...entries].reverse().map((e) => inverse(e, entries)).filter((s): s is NonNullable<Step> => s !== null);
}

async function entriesOf(change: TallyChange): Promise<Entry[]> {
  if (!change.auditIds.length) return [];
  const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.orgId, change.orgId), inArray(auditLogs.id, change.auditIds)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return change.auditIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)) as Entry[];
}

export type ChangeOutcome = { message: string; changeId: string | null; undoable: boolean };

/**
 * Run a confirmed Tally change as one all-or-nothing unit and record it for Undo.
 * The same key twice (a double click, a retried request) runs it once.
 */
export async function recordChange(actor: Actor, meta: { key: string; tool: string; title: string }, fn: () => Promise<string>): Promise<ChangeOutcome> {
  const [done] = await db.select().from(tallyChanges).where(and(eq(tallyChanges.orgId, actor.orgId), eq(tallyChanges.key, meta.key)));
  if (done) return { message: `Already done: ${done.result}`, changeId: done.id, undoable: done.status === "DONE" && !done.notUndoableReason };
  try {
    return await atomically(async () => {
      const ids: string[] = [];
      const message = await recordingAudits(ids, fn);
      // Every audit entry this change wrote has this transaction's timestamp. If one was written by a
      // path that didn't report itself, Undo can't see the whole change, so it is not offered.
      const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where org_id = ${actor.orgId} and user_id = ${actor.userId} and created_at = now()`)).rows;
      let notUndoable: string | null = n === ids.length ? null : "Part of this change was written in a way Undo can't follow.";
      if (!notUndoable && !ids.length) notUndoable = "Nothing was recorded to undo.";
      if (!notUndoable) {
        try {
          plan(await entriesOf({ orgId: actor.orgId, auditIds: ids } as TallyChange));
        } catch (error) {
          notUndoable = error instanceof InventoryError ? error.message : "Undo can't reverse this change.";
        }
      }
      const [row] = await db
        .insert(tallyChanges)
        .values({
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          userId: actor.userId,
          userName: actor.userName,
          key: meta.key,
          tool: meta.tool,
          title: meta.title.slice(0, 200),
          result: message.slice(0, 500),
          auditIds: ids,
          notUndoableReason: notUndoable,
        })
        .returning({ id: tallyChanges.id });
      return { message, changeId: row.id, undoable: !notUndoable };
    });
  } catch (error) {
    // Two confirms raced; the other one saved first.
    if ((error as { code?: string }).code === "23505" && String((error as { constraint?: string }).constraint ?? "").includes("tally_changes")) {
      const [won] = await db.select().from(tallyChanges).where(and(eq(tallyChanges.orgId, actor.orgId), eq(tallyChanges.key, meta.key)));
      if (won) return { message: `Already done: ${won.result}`, changeId: won.id, undoable: won.status === "DONE" && !won.notUndoableReason };
    }
    throw error;
  }
}

async function loadChange(actor: Actor, changeId: string): Promise<TallyChange> {
  const [change] = await db
    .select()
    .from(tallyChanges)
    .where(and(eq(tallyChanges.id, changeId), eq(tallyChanges.orgId, actor.orgId), eq(tallyChanges.facilityId, actor.facilityId)));
  if (!change) throw new InventoryError("That Tally change was not found at this facility.");
  if (change.status === "UNDONE") throw new InventoryError(`This was already undone${change.undoneByName ? ` by ${change.undoneByName}` : ""}.`);
  if (change.notUndoableReason) throw new InventoryError(`This change can't be undone: ${change.notUndoableReason}`);
  return change;
}

/** Refuse when anything the change touched has been changed again since, by anyone. */
async function assertNothingChangedSince(change: TallyChange, entries: Entry[], ignoreIds: string[] = []): Promise<void> {
  const touched = new Map<string, Entry>();
  for (const e of entries) if (e.entityType !== "print_job") touched.set(`${e.entityType}:${e.entityId}`, e);
  for (const e of touched.values()) {
    const [later] = await db
      .select({ action: auditLogs.action, userName: auditLogs.userName, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.orgId, change.orgId),
          eq(auditLogs.entityType, e.entityType),
          eq(auditLogs.entityId, e.entityId),
          gt(auditLogs.createdAt, change.createdAt),
          notInArray(auditLogs.id, [...change.auditIds, ...ignoreIds]),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    if (later) {
      const what = e.entityType === "Package" ? `Package ${str(e.after?.tag ?? e.before?.tag)}` : `That ${e.entityType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`;
      const when = later.createdAt.toLocaleString("en-US", { timeZone: currentZone(), dateStyle: "medium", timeStyle: "short" });
      throw new InventoryError(
        `${what} has changed since (${later.action.toLowerCase().replaceAll("_", " ")} by ${later.userName}, ${when}). Undo would overwrite that, so it's blocked. Undo the later change first, or fix it by hand.`,
      );
    }
  }
}

export type UndoPreview = { change: TallyChange; steps: string[] };

/** What Undo would do, checked by running it and rolling back. */
export async function previewUndo(actor: Actor, changeId: string): Promise<UndoPreview> {
  const change = await loadChange(actor, changeId);
  const entries = await entriesOf(change);
  await assertNothingChangedSince(change, entries);
  const steps = plan(entries);
  await dryRun(async () => {
    for (const step of steps) await step.run(actor, `Undo of Tally change: ${change.title}`);
  });
  return { change, steps: steps.map((s) => s.what) };
}

/** Reverse a whole Tally change, all or nothing. Every reversal gets its own audit entry. */
export async function undoChange(actor: Actor, changeId: string): Promise<string> {
  return atomically(async () => {
    const [locked] = await db.select().from(tallyChanges).where(eq(tallyChanges.id, changeId)).for("update");
    if (locked?.status === "UNDONE") throw new InventoryError(`This was already undone${locked.undoneByName ? ` by ${locked.undoneByName}` : ""}.`);
    const change = await loadChange(actor, changeId);
    const entries = await entriesOf(change);
    await assertNothingChangedSince(change, entries);
    const reason = `Undo of Tally change: ${change.title}`;
    const steps = plan(entries);
    const written: string[] = [];
    await recordingAudits(written, async () => {
      for (const step of steps) await step.run(actor, reason);
    });
    // The check above can't lock anything, so someone could save a change between it and the steps. The steps
    // have now locked what they touch, so look again: anything newer than this Undo's own entries means
    // someone got in first, and the whole Undo rolls back instead of overwriting their change.
    await assertNothingChangedSince(change, entries, written);
    await db.update(tallyChanges).set({ status: "UNDONE", undoneAt: new Date(), undoneByName: actor.userName }).where(eq(tallyChanges.id, change.id));
    return `Undone: ${change.title}. ${steps.length} step${steps.length === 1 ? "" : "s"} reversed, each recorded in the audit trail.`;
  });
}

export async function recentChanges(scope: { orgId: string; facilityId: string }, limit = 20): Promise<TallyChange[]> {
  return db
    .select()
    .from(tallyChanges)
    .where(and(eq(tallyChanges.orgId, scope.orgId), eq(tallyChanges.facilityId, scope.facilityId)))
    .orderBy(desc(tallyChanges.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}
