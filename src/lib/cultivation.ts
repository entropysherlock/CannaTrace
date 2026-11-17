import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  cultivationTasks,
  harvestPackages,
  harvests,
  items,
  plantBatches,
  plants,
  strains,
  wasteLogs,
  type Harvest,
  type Package,
  type Plant,
} from "@/db/schema";
import { MAX_PLANTS_PER_ACTION, harvestOnHand, takeFromHarvest, toGrams } from "./cultivation-math";
import { db, type Tx } from "./db";
import { InventoryError, assertLocation, audit, createPackageInTx, type Actor } from "./inventory";
import { normalizeTag, parsePositiveQty } from "./inventory-math";
import { convert, dimensionOf } from "./units";

const store = (value: Decimal) => value.toFixed(4);
const scoped = <T extends { orgId: unknown; facilityId: unknown }>(table: T, actor: Actor) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  and(eq(table.orgId as any, actor.orgId), eq(table.facilityId as any, actor.facilityId));

function requireText(value: string | null | undefined, message: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new InventoryError(message);
  return text;
}

function parseCount(value: unknown, what: string): number {
  const count = Number(String(value ?? "").trim());
  if (!Number.isInteger(count) || count < 1) throw new InventoryError(`${what} must be a whole number of at least 1.`);
  return count;
}

export async function createStrain(
  actor: Actor,
  input: { name: string; type: string; floweringDays?: unknown },
): Promise<{ id: string }> {
  const name = requireText(input.name, "Enter a strain name.");
  if (!["INDICA", "SATIVA", "HYBRID", "CBD"].includes(input.type)) throw new InventoryError("Choose a strain type.");
  const daysText = String(input.floweringDays ?? "").trim();
  const floweringDays = daysText === "" ? null : parseCount(daysText, "Flowering days");
  return db.transaction(async (tx) => {
    const [strain] = await tx
      .insert(strains)
      .values({ orgId: actor.orgId, name, type: input.type as "INDICA", floweringDays })
      .onConflictDoNothing({ target: [strains.orgId, strains.name] })
      .returning({ id: strains.id });
    if (!strain) throw new InventoryError(`There is already a strain called ${name}.`);
    await audit(tx, actor, { entityType: "Strain", entityId: strain.id, action: "CREATE", after: { name, type: input.type } });
    return strain;
  });
}

/** Start a group of immature plants (clones or seeds) that are not individually tagged yet. */
export async function createPlantBatch(
  actor: Actor,
  input: { name: string; strainId: string; source: string; count: unknown; locationId: string },
): Promise<{ id: string }> {
  const name = requireText(input.name, "Give the batch a name, for example the strain initials and today's date.");
  if (!["CLONE", "SEED"].includes(input.source)) throw new InventoryError("Choose clones or seeds.");
  const count = parseCount(input.count, "Plant count");
  if (count > 10000) throw new InventoryError("A batch can hold at most 10,000 plants.");
  return db.transaction(async (tx) => {
    const [strain] = await tx
      .select({ id: strains.id })
      .from(strains)
      .where(and(eq(strains.id, input.strainId), eq(strains.orgId, actor.orgId), eq(strains.active, true)));
    if (!strain) throw new InventoryError("Pick a strain from the list.");
    await assertLocation(tx, actor, input.locationId);
    const [batch] = await tx
      .insert(plantBatches)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        name,
        strainId: strain.id,
        source: input.source as "CLONE",
        locationId: input.locationId,
        initialCount: count,
        untaggedCount: count,
        userId: actor.userId,
      })
      .onConflictDoNothing({ target: [plantBatches.facilityId, plantBatches.name] })
      .returning({ id: plantBatches.id });
    if (!batch) throw new InventoryError(`This facility already has a batch called ${name}.`);
    await audit(tx, actor, {
      entityType: "PlantBatch",
      entityId: batch.id,
      action: "CREATE",
      after: { name, source: input.source, count, locationId: input.locationId },
    });
    return batch;
  });
}

async function lockBatch(tx: Tx, actor: Actor, batchId: string) {
  const [batch] = await tx
    .select()
    .from(plantBatches)
    .where(and(eq(plantBatches.id, batchId), scoped(plantBatches, actor)))
    .for("update");
  if (!batch) throw new InventoryError("That batch was not found at this facility.");
  return batch;
}

/** Give individual tags to plants in a batch. They become vegetative plants tracked one by one. */
export async function tagPlants(
  actor: Actor,
  input: { batchId: string; tags: string[]; locationId?: string | null },
): Promise<Plant[]> {
  const tags = input.tags.map((tag) => normalizeTag(tag));
  if (tags.length === 0) throw new InventoryError("Scan or type at least one tag.");
  if (new Set(tags).size !== tags.length) throw new InventoryError("Each plant needs a different tag.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, actor, input.batchId);
    if (tags.length > batch.untaggedCount) {
      throw new InventoryError(
        `This batch has ${batch.untaggedCount} untagged plant${batch.untaggedCount === 1 ? "" : "s"} left, but ${tags.length} tags were entered.`,
      );
    }
    const locationId = input.locationId || batch.locationId;
    await assertLocation(tx, actor, locationId);
    const created = await tx
      .insert(plants)
      .values(
        tags.map((tag) => ({
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          tag,
          strainId: batch.strainId,
          batchId: batch.id,
          locationId,
        })),
      )
      .onConflictDoNothing({ target: [plants.orgId, plants.tag] })
      .returning();
    if (created.length !== tags.length) {
      const made = new Set(created.map((p) => p.tag));
      const taken = tags.filter((t) => !made.has(t));
      throw new InventoryError(
        `Plant tag ${taken.slice(0, 5).join(", ")}${taken.length > 5 ? ` and ${taken.length - 5} more` : ""} is already in use. No plants were tagged.`,
      );
    }
    const left = batch.untaggedCount - tags.length;
    await tx
      .update(plantBatches)
      .set({ untaggedCount: left, status: left === 0 ? "CLOSED" : "ACTIVE" })
      .where(eq(plantBatches.id, batch.id));
    await audit(tx, actor, {
      entityType: "PlantBatch",
      entityId: batch.id,
      action: "TAG_PLANTS",
      before: { untaggedCount: batch.untaggedCount },
      after: { untaggedCount: left, tagged: tags.length, firstTag: tags[0], lastTag: tags[tags.length - 1] },
    });
    return created;
  });
}

/** Record immature plants in a batch that died or were culled. */
export async function destroyBatchPlants(
  actor: Actor,
  input: { batchId: string; count: unknown; reason: string; wasteGrams?: unknown; wasteUnit?: string },
): Promise<void> {
  const count = parseCount(input.count, "Plant count");
  const reason = requireText(input.reason, "Say why the plants were destroyed. It goes in the audit trail.");
  const wasteText = String(input.wasteGrams ?? "").trim();
  const waste = wasteText === "" ? null : toGrams(wasteText, input.wasteUnit ?? "G", "Waste weight");
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, actor, input.batchId);
    if (count > batch.untaggedCount) {
      throw new InventoryError(`This batch only has ${batch.untaggedCount} untagged plants left.`);
    }
    const left = batch.untaggedCount - count;
    await tx
      .update(plantBatches)
      .set({ untaggedCount: left, destroyedCount: batch.destroyedCount + count, status: left === 0 ? "CLOSED" : "ACTIVE" })
      .where(eq(plantBatches.id, batch.id));
    if (waste) {
      await tx.insert(wasteLogs).values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        sourceType: "BATCH",
        sourceId: batch.id,
        weightGrams: store(waste),
        reason,
        userId: actor.userId,
        userName: actor.userName,
      });
    }
    await audit(tx, actor, {
      entityType: "PlantBatch",
      entityId: batch.id,
      action: "DESTROY_PLANTS",
      before: { untaggedCount: batch.untaggedCount },
      after: { untaggedCount: left, destroyed: count, wasteGrams: waste?.toString() ?? null },
      reason,
    });
  });
}

/** Lock a set of active plants at this facility, in a stable order. */
async function lockPlants(tx: Tx, actor: Actor, plantIds: string[]): Promise<Plant[]> {
  const ids = [...new Set(plantIds)].sort();
  if (ids.length === 0) throw new InventoryError("Select at least one plant.");
  if (ids.length > MAX_PLANTS_PER_ACTION) throw new InventoryError(`Select at most ${MAX_PLANTS_PER_ACTION} plants at a time.`);
  const rows = await tx
    .select()
    .from(plants)
    .where(and(inArray(plants.id, ids), scoped(plants, actor)))
    .orderBy(plants.id)
    .for("update");
  if (rows.length !== ids.length) throw new InventoryError("Some of the selected plants were not found at this facility.");
  const inactive = rows.filter((p) => p.status !== "ACTIVE");
  if (inactive.length) {
    throw new InventoryError(
      `Plant ${inactive[0].tag} is already ${inactive[0].status.toLowerCase()}${inactive.length > 1 ? ` (and ${inactive.length - 1} more)` : ""}. Refresh and select again.`,
    );
  }
  return rows;
}

async function auditPlants(tx: Tx, actor: Actor, rows: Plant[], action: string, after: Record<string, unknown>, reason?: string) {
  // One entry per plant keeps every plant's own history complete.
  for (const plant of rows) {
    await audit(tx, actor, {
      entityType: "Plant",
      entityId: plant.id,
      action,
      before: { tag: plant.tag, phase: plant.phase, status: plant.status, locationId: plant.locationId },
      after,
      reason,
    });
  }
}

export async function changePlantPhase(actor: Actor, input: { plantIds: string[]; phase: string }): Promise<number> {
  if (!["VEGETATIVE", "FLOWERING"].includes(input.phase)) throw new InventoryError("Choose a growth phase.");
  const phase = input.phase as "VEGETATIVE" | "FLOWERING";
  return db.transaction(async (tx) => {
    const rows = (await lockPlants(tx, actor, input.plantIds)).filter((p) => p.phase !== phase);
    if (rows.length === 0) throw new InventoryError(`The selected plants are already ${phase.toLowerCase()}.`);
    await tx
      .update(plants)
      .set({ phase, phaseChangedAt: new Date() })
      .where(inArray(plants.id, rows.map((p) => p.id)));
    await auditPlants(tx, actor, rows, "PHASE_CHANGE", { phase });
    return rows.length;
  });
}

export async function movePlants(actor: Actor, input: { plantIds: string[]; locationId: string }): Promise<number> {
  return db.transaction(async (tx) => {
    if (!input.locationId) throw new InventoryError("Choose a room to move the plants to.");
    await assertLocation(tx, actor, input.locationId);
    const rows = (await lockPlants(tx, actor, input.plantIds)).filter((p) => p.locationId !== input.locationId);
    if (rows.length === 0) throw new InventoryError("The selected plants are already in that room.");
    await tx
      .update(plants)
      .set({ locationId: input.locationId })
      .where(inArray(plants.id, rows.map((p) => p.id)));
    await auditPlants(tx, actor, rows, "MOVE", { locationId: input.locationId });
    return rows.length;
  });
}

export async function destroyPlants(
  actor: Actor,
  input: { plantIds: string[]; reason: string; wasteGrams?: unknown; wasteUnit?: string },
): Promise<number> {
  const reason = requireText(input.reason, "Say why the plants were destroyed. It goes in the audit trail.");
  const wasteText = String(input.wasteGrams ?? "").trim();
  const waste = wasteText === "" ? null : toGrams(wasteText, input.wasteUnit ?? "G", "Waste weight");
  return db.transaction(async (tx) => {
    const rows = await lockPlants(tx, actor, input.plantIds);
    await tx
      .update(plants)
      .set({ status: "DESTROYED" })
      .where(inArray(plants.id, rows.map((p) => p.id)));
    if (waste) {
      await tx.insert(wasteLogs).values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        sourceType: "PLANT",
        sourceId: rows[0].id,
        weightGrams: store(waste),
        reason: `${rows.length} plant${rows.length === 1 ? "" : "s"}: ${reason}`,
        userId: actor.userId,
        userName: actor.userName,
      });
    }
    await auditPlants(tx, actor, rows, "DESTROY", { status: "DESTROYED" }, reason);
    return rows.length;
  });
}

/** Cut down flowering plants of one strain and record their combined wet weight as a harvest. */
export async function harvestPlants(
  actor: Actor,
  input: { plantIds: string[]; name: string; wetWeight: unknown; unit: string; locationId: string },
): Promise<Harvest> {
  const name = requireText(input.name, "Give the harvest a name, for example the strain initials and today's date.");
  const wet = toGrams(input.wetWeight, input.unit, "Wet weight");
  return db.transaction(async (tx) => {
    if (!input.locationId) throw new InventoryError("Choose the room where the harvest will dry.");
    await assertLocation(tx, actor, input.locationId);
    const rows = await lockPlants(tx, actor, input.plantIds);
    const notFlowering = rows.filter((p) => p.phase !== "FLOWERING");
    if (notFlowering.length) {
      throw new InventoryError(
        `Only flowering plants can be harvested. ${notFlowering[0].tag}${notFlowering.length > 1 ? ` and ${notFlowering.length - 1} more are` : " is"} still vegetative.`,
      );
    }
    if (rows.some((p) => p.strainId !== rows[0].strainId)) {
      throw new InventoryError("A harvest can only contain one strain. Harvest each strain separately.");
    }
    const [harvest] = await tx
      .insert(harvests)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        name,
        strainId: rows[0].strainId,
        locationId: input.locationId,
        plantCount: rows.length,
        wetWeight: store(wet),
        userId: actor.userId,
      })
      .onConflictDoNothing({ target: [harvests.facilityId, harvests.name] })
      .returning();
    if (!harvest) throw new InventoryError(`This facility already has a harvest called ${name}.`);
    await tx
      .update(plants)
      .set({ status: "HARVESTED", harvestId: harvest.id })
      .where(inArray(plants.id, rows.map((p) => p.id)));
    await auditPlants(tx, actor, rows, "HARVEST", { status: "HARVESTED", harvest: name });
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "CREATE",
      after: { name, plantCount: rows.length, wetWeightGrams: wet.toString() },
    });
    return harvest;
  });
}

async function lockHarvest(tx: Tx, actor: Actor, harvestId: string): Promise<Harvest> {
  const [harvest] = await tx
    .select()
    .from(harvests)
    .where(and(eq(harvests.id, harvestId), scoped(harvests, actor)))
    .for("update");
  if (!harvest) throw new InventoryError("That harvest was not found at this facility.");
  if (harvest.status === "FINISHED") throw new InventoryError("This harvest is finished and can no longer be changed.");
  return harvest;
}

/** Record the weight after drying. The difference from the wet weight is moisture loss. */
export async function recordDryWeight(
  actor: Actor,
  input: { harvestId: string; dryWeight: unknown; unit: string },
): Promise<Harvest> {
  const dry = toGrams(input.dryWeight, input.unit, "Dry weight");
  return db.transaction(async (tx) => {
    const harvest = await lockHarvest(tx, actor, input.harvestId);
    if (dry.gt(harvest.wetWeight)) {
      throw new InventoryError(`Dry weight cannot be more than the wet weight (${new Decimal(harvest.wetWeight).toString()} g).`);
    }
    const used = new Decimal(harvest.wasteWeight).add(harvest.packagedWeight);
    if (dry.lt(used)) {
      throw new InventoryError(
        `${used.toString()} g of this harvest has already been packaged or logged as waste, so the dry weight cannot be less than that.`,
      );
    }
    const [updated] = await tx.update(harvests).set({ dryWeight: store(dry) }).where(eq(harvests.id, harvest.id)).returning();
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "DRY_WEIGHT",
      before: { dryWeightGrams: harvest.dryWeight },
      after: { dryWeightGrams: dry.toString() },
    });
    return updated;
  });
}

export async function logHarvestWaste(
  actor: Actor,
  input: { harvestId: string; weight: unknown; unit: string; reason: string },
): Promise<Harvest> {
  const grams = toGrams(input.weight, input.unit, "Waste weight");
  const reason = requireText(input.reason, "Say what the waste was, for example stems or trim. It goes in the audit trail.");
  return db.transaction(async (tx) => {
    const harvest = await lockHarvest(tx, actor, input.harvestId);
    takeFromHarvest(harvestOnHand(harvest), grams, "The waste");
    const [updated] = await tx
      .update(harvests)
      .set({ wasteWeight: store(new Decimal(harvest.wasteWeight).add(grams)) })
      .where(eq(harvests.id, harvest.id))
      .returning();
    await tx.insert(wasteLogs).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      sourceType: "HARVEST",
      sourceId: harvest.id,
      weightGrams: store(grams),
      reason,
      userId: actor.userId,
      userName: actor.userName,
    });
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "WASTE",
      after: { wasteGrams: grams.toString(), totalWasteGrams: new Decimal(updated.wasteWeight).toString() },
      reason,
    });
    return updated;
  });
}

/** Move weight out of a harvest into a new inventory package. The item must be tracked by weight. */
export async function packageFromHarvest(
  actor: Actor,
  input: { harvestId: string; tag: string; itemId: string; quantity: unknown; locationId: string },
): Promise<Package> {
  return db.transaction(async (tx) => {
    const harvest = await lockHarvest(tx, actor, input.harvestId);
    const [item] = await tx
      .select({ unit: items.unit })
      .from(items)
      .where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId), eq(items.active, true)));
    if (!item) throw new InventoryError("Pick an item from the list.");
    if (dimensionOf(item.unit) !== "WEIGHT") {
      throw new InventoryError("Harvests can only be packaged into items tracked by weight, such as bulk flower or trim.");
    }
    const quantity = parsePositiveQty(input.quantity);
    const grams = convert(quantity, item.unit, "G").toDecimalPlaces(4);
    takeFromHarvest(harvestOnHand(harvest), grams, "The package");

    const pkg = await createPackageInTx(tx, actor, {
      tag: input.tag,
      itemId: input.itemId,
      quantity,
      locationId: input.locationId,
      lotNumber: harvest.name,
      note: `Packaged from harvest ${harvest.name}`,
      type: "CONVERT_IN",
      auditAction: "CREATED_FROM_HARVEST",
      auditExtra: { harvest: harvest.name },
    });
    await tx
      .update(harvests)
      .set({ packagedWeight: store(new Decimal(harvest.packagedWeight).add(grams)) })
      .where(eq(harvests.id, harvest.id));
    await tx.insert(harvestPackages).values({ harvestId: harvest.id, packageId: pkg.id, weightGrams: store(grams) });
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "PACKAGE",
      after: { packageTag: pkg.tag, grams: grams.toString() },
    });
    return pkg;
  });
}

/** Close a harvest. Whatever weight is unaccounted for is recorded as moisture loss. */
export async function finishHarvest(actor: Actor, input: { harvestId: string }): Promise<Harvest> {
  return db.transaction(async (tx) => {
    const harvest = await lockHarvest(tx, actor, input.harvestId);
    const onHand = harvestOnHand(harvest);
    if (harvest.dryWeight !== null && onHand.gt(0)) {
      throw new InventoryError(
        `${onHand.toString()} g of dried product is still unaccounted for. Package it or log it as waste before finishing.`,
      );
    }
    const moistureLoss = new Decimal(harvest.wetWeight).sub(harvest.wasteWeight).sub(harvest.packagedWeight);
    const [updated] = await tx
      .update(harvests)
      .set({ status: "FINISHED", moistureLoss: store(moistureLoss), finishedAt: new Date() })
      .where(eq(harvests.id, harvest.id))
      .returning();
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "FINISH",
      after: {
        wetWeightGrams: new Decimal(harvest.wetWeight).toString(),
        packagedGrams: new Decimal(harvest.packagedWeight).toString(),
        wasteGrams: new Decimal(harvest.wasteWeight).toString(),
        moistureLossGrams: moistureLoss.toString(),
      },
    });
    return updated;
  });
}

export async function createTask(
  actor: Actor,
  input: { title: string; dueDate?: string | null; locationId?: string | null },
): Promise<void> {
  const title = requireText(input.title, "Describe the task.");
  const dueDate = input.dueDate?.trim() || null;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new InventoryError("Due date must be a valid date.");
  await db.transaction(async (tx) => {
    if (input.locationId) await assertLocation(tx, actor, input.locationId);
    await tx.insert(cultivationTasks).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      title: title.slice(0, 200),
      dueDate,
      locationId: input.locationId || null,
      createdByName: actor.userName,
    });
  });
}

export async function completeTask(actor: Actor, input: { taskId: string }): Promise<void> {
  await db
    .update(cultivationTasks)
    .set({ done: true, doneAt: sql`now()`, doneByName: actor.userName })
    .where(and(eq(cultivationTasks.id, input.taskId), scoped(cultivationTasks, actor), eq(cultivationTasks.done, false)));
}

// ---------- Reversals, used by Undo. Each writes its own audit entry; nothing is erased. ----------

/** Put a harvest's dry weight back to what it was (or to not yet weighed). */
export async function restoreDryWeight(actor: Actor, input: { harvestId: string; dryWeightGrams: string | null; reason: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const harvest = await lockHarvest(tx, actor, input.harvestId);
    const target = input.dryWeightGrams === null ? null : new Decimal(input.dryWeightGrams);
    const used = new Decimal(harvest.wasteWeight).add(harvest.packagedWeight);
    if (target && target.lt(used)) throw new InventoryError(`Harvest ${harvest.name} already has ${used.toString()} g packaged or wasted, more than its old dry weight.`);
    await tx.update(harvests).set({ dryWeight: target ? store(target) : null }).where(eq(harvests.id, harvest.id));
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "DRY_WEIGHT",
      before: { dryWeightGrams: harvest.dryWeight },
      after: { dryWeightGrams: target?.toString() ?? null },
      reason: input.reason,
    });
  });
}

/** Take back waste logged against a harvest: the weight returns to the harvest, and a negative waste line keeps the log honest. */
export async function reverseHarvestWaste(actor: Actor, input: { harvestId: string; grams: string; reason: string }): Promise<void> {
  const grams = new Decimal(input.grams);
  await db.transaction(async (tx) => {
    const harvest = await lockHarvest(tx, actor, input.harvestId);
    if (grams.gt(harvest.wasteWeight)) throw new InventoryError(`Harvest ${harvest.name} only has ${new Decimal(harvest.wasteWeight).toString()} g of waste logged.`);
    const [updated] = await tx
      .update(harvests)
      .set({ wasteWeight: store(new Decimal(harvest.wasteWeight).sub(grams)) })
      .where(eq(harvests.id, harvest.id))
      .returning();
    await tx.insert(wasteLogs).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      sourceType: "HARVEST",
      sourceId: harvest.id,
      weightGrams: store(grams.neg()),
      reason: input.reason,
      userId: actor.userId,
      userName: actor.userName,
    });
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "WASTE_REVERSED",
      after: { wasteGrams: grams.neg().toString(), totalWasteGrams: new Decimal(updated.wasteWeight).toString() },
      reason: input.reason,
    });
  });
}

/** Give a package's weight back to the harvest it was made from. The package itself is emptied separately. */
export async function reverseHarvestPackage(actor: Actor, input: { harvestId: string; packageTag: string; grams: string; reason: string }): Promise<void> {
  const grams = new Decimal(input.grams);
  await db.transaction(async (tx) => {
    const harvest = await lockHarvest(tx, actor, input.harvestId);
    if (grams.gt(harvest.packagedWeight)) throw new InventoryError(`Harvest ${harvest.name} only has ${new Decimal(harvest.packagedWeight).toString()} g packaged.`);
    await tx
      .update(harvests)
      .set({ packagedWeight: store(new Decimal(harvest.packagedWeight).sub(grams)) })
      .where(eq(harvests.id, harvest.id));
    await audit(tx, actor, {
      entityType: "Harvest",
      entityId: harvest.id,
      action: "PACKAGE_REVERSED",
      after: { packageTag: input.packageTag, grams: grams.neg().toString() },
      reason: input.reason,
    });
  });
}

/** Reopen a finished harvest so it can be changed again. */
export async function reopenHarvest(actor: Actor, input: { harvestId: string; reason: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [harvest] = await tx
      .select()
      .from(harvests)
      .where(and(eq(harvests.id, input.harvestId), scoped(harvests, actor)))
      .for("update");
    if (!harvest) throw new InventoryError("That harvest was not found at this facility.");
    if (harvest.status !== "FINISHED") return;
    await tx.update(harvests).set({ status: "DRYING", moistureLoss: null, finishedAt: null }).where(eq(harvests.id, harvest.id));
    await audit(tx, actor, { entityType: "Harvest", entityId: harvest.id, action: "REOPEN", reason: input.reason });
  });
}
