import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogs,
  customers,
  cycleCountLines,
  cycleCounts,
  facilities,
  inventoryTransactions,
  items,
  labResults,
  locations,
  packageLineage,
  packages,
  type Package,
  type PackageStatus,
} from "@/db/schema";
import { noteAudit } from "./audit-recorder";
import { db, type Tx } from "./db";
import { packFor, wasteRule } from "./rules";
import { enqueueSyncEvent } from "./sync";
import { InventoryError, applyDelta, normalizeTag, parsePositiveQty, planSplit, weightedAverageCost } from "./inventory-math";
import { roundQty } from "./units";

export { InventoryError };

/** Who is making the change and where. Every inventory write needs one. */
export type Actor = {
  userId: string;
  userName: string;
  orgId: string;
  facilityId: string;
};

export const ADJUST_REASONS = [
  { code: "COUNT_CORRECTION", label: "Cycle count correction" },
  { code: "DRYING", label: "Moisture loss / drying" },
  { code: "SCALE_VARIANCE", label: "Scale variance" },
  { code: "DAMAGE", label: "Damaged product" },
  { code: "SAMPLE", label: "Sample pulled" },
  { code: "ENTRY_ERROR", label: "Data entry error" },
  { code: "THEFT_LOSS", label: "Theft or loss" },
] as const;

export function reasonLabel(code: string | null | undefined): string {
  return ADJUST_REASONS.find((r) => r.code === code)?.label ?? code ?? "";
}

const store = (value: Decimal) => value.toFixed(4);

function snapshot(pkg: Package) {
  return {
    tag: pkg.tag,
    quantity: new Decimal(pkg.quantity).toString(),
    unit: pkg.unit,
    status: pkg.status,
    locationId: pkg.locationId,
  };
}

export async function audit(
  tx: Tx,
  actor: Actor,
  entry: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown; reason?: string | null },
) {
  const [row] = await tx
    .insert(auditLogs)
    .values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      userId: actor.userId,
      userName: actor.userName,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason?.trim() || null,
    })
    .returning({ id: auditLogs.id });
  noteAudit(row?.id);
  await enqueueSyncEvent(tx, actor, entry);
}

/** Lock the package row for the rest of the transaction so two edits cannot interleave. */
export async function lockPackage(tx: Tx, actor: Actor, packageId: string): Promise<Package> {
  const [pkg] = await tx
    .select()
    .from(packages)
    .where(and(eq(packages.id, packageId), eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId)))
    .for("update");
  if (!pkg) throw new InventoryError("That package was not found at this facility.");
  return pkg;
}

function assertEditable(status: PackageStatus) {
  if (status === "DESTROYED" || status === "FINISHED") {
    throw new InventoryError(`This package is ${status.toLowerCase()} and can no longer be changed.`);
  }
}

export async function assertLocation(tx: Tx, actor: Actor, locationId: string) {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.orgId, actor.orgId), eq(locations.facilityId, actor.facilityId)));
  if (!location) throw new InventoryError("That location does not exist at this facility.");
}

/**
 * Create a package inside an existing transaction, with its ledger row and audit entry.
 * Used by receiving and by anything else that brings new product into inventory.
 */
export async function createPackageInTx(
  tx: Tx,
  actor: Actor,
  input: {
    tag: string;
    itemId: string;
    quantity: unknown;
    locationId: string;
    lotNumber?: string | null;
    costPerUnit?: unknown;
    note?: string | null;
    type: "RECEIVE" | "CONVERT_IN";
    auditAction: string;
    auditExtra?: Record<string, unknown>;
  },
): Promise<Package> {
  const tag = normalizeTag(input.tag);
  const quantity = parsePositiveQty(input.quantity);
  const costText = input.costPerUnit == null ? "" : String(input.costPerUnit).trim();
  const cost = costText === "" ? null : parsePositiveQty(costText, "Cost per unit");

  const [item] = await tx
    .select()
    .from(items)
    .where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId), eq(items.active, true)));
  if (!item) throw new InventoryError("Pick an item from the list.");
  await assertLocation(tx, actor, input.locationId);

  const [pkg] = await tx
    .insert(packages)
    .values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      tag,
      itemId: item.id,
      quantity: store(quantity),
      unit: item.unit,
      locationId: input.locationId,
      lotNumber: input.lotNumber?.trim() || null,
      costPerUnit: cost ? store(cost) : null,
    })
    .onConflictDoNothing({ target: [packages.orgId, packages.tag] })
    .returning();
  if (!pkg) throw new InventoryError(`Tag ${tag} is already in use. Every package needs its own tag.`);

  await tx.insert(inventoryTransactions).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    packageId: pkg.id,
    type: input.type,
    quantityDelta: store(quantity),
    quantityBefore: "0",
    quantityAfter: store(quantity),
    unit: item.unit,
    toLocationId: input.locationId,
    note: input.note?.trim() || null,
    userId: actor.userId,
  });
  await audit(tx, actor, {
    entityType: "Package",
    entityId: pkg.id,
    action: input.auditAction,
    after: { ...snapshot(pkg), ...input.auditExtra },
    reason: input.note,
  });
  return pkg;
}

/** Take quantity out of an active package for production. Empties are marked finished. */
export async function consumeFromPackageInTx(
  tx: Tx,
  actor: Actor,
  input: { packageId: string; quantity: unknown; note: string; kind?: "PRODUCTION" | "RETAIL_SALE" },
): Promise<{ before: Package; after: Package; quantity: Decimal }> {
  const sale = input.kind === "RETAIL_SALE";
  const quantity = parsePositiveQty(input.quantity);
  const pkg = await lockPackage(tx, actor, input.packageId);
  if (pkg.status !== "ACTIVE") {
    throw new InventoryError(
      `Package ${pkg.tag} is ${pkg.status.replace("_", " ").toLowerCase()} and cannot be ${sale ? "sold" : "used in production"}.`,
    );
  }
  const change = applyDelta(pkg.quantity, quantity.neg());
  const [updated] = await tx
    .update(packages)
    .set({ quantity: store(change.after), status: change.after.isZero() ? "FINISHED" : "ACTIVE" })
    .where(eq(packages.id, pkg.id))
    .returning();
  await tx.insert(inventoryTransactions).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    packageId: pkg.id,
    type: sale ? "SELL" : "CONVERT_OUT",
    quantityDelta: store(change.delta),
    quantityBefore: store(change.before),
    quantityAfter: store(change.after),
    unit: pkg.unit,
    note: input.note,
    userId: actor.userId,
  });
  await audit(tx, actor, {
    entityType: "Package",
    entityId: pkg.id,
    action: sale ? "RETAIL_SALE" : "USED_IN_PRODUCTION",
    before: snapshot(pkg),
    after: snapshot(updated),
    reason: input.note,
  });
  return { before: pkg, after: updated, quantity };
}

/** Put back quantity that was taken for production but not used. Reopens a package emptied by that use. */
export async function returnToPackageInTx(
  tx: Tx,
  actor: Actor,
  input: { packageId: string; quantity: Decimal; note: string; auditAction?: string },
): Promise<Package> {
  const pkg = await lockPackage(tx, actor, input.packageId);
  if (pkg.status === "DESTROYED") throw new InventoryError(`Package ${pkg.tag} was destroyed, so nothing can be returned to it.`);
  const change = applyDelta(pkg.quantity, input.quantity);
  const [updated] = await tx
    .update(packages)
    .set({ quantity: store(change.after), status: pkg.status === "FINISHED" ? "ACTIVE" : pkg.status })
    .where(eq(packages.id, pkg.id))
    .returning();
  await tx.insert(inventoryTransactions).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    packageId: pkg.id,
    type: "CONVERT_IN",
    quantityDelta: store(change.delta),
    quantityBefore: store(change.before),
    quantityAfter: store(change.after),
    unit: pkg.unit,
    note: input.note,
    userId: actor.userId,
  });
  await audit(tx, actor, {
    entityType: "Package",
    entityId: pkg.id,
    action: input.auditAction ?? "RETURNED_FROM_PRODUCTION",
    before: snapshot(pkg),
    after: snapshot(updated),
    reason: input.note,
  });
  return updated;
}

export async function receivePackage(
  actor: Actor,
  input: {
    tag: string;
    itemId: string;
    quantity: unknown;
    locationId: string;
    lotNumber?: string | null;
    costPerUnit?: unknown;
    note?: string | null;
    /** The vendor it was bought from, if any. */
    vendorId?: string | null;
  },
): Promise<Package> {
  return db.transaction(async (tx) => {
    let vendorName: string | null = null;
    if (input.vendorId) {
      const [v] = await tx.select({ name: customers.name }).from(customers).where(and(eq(customers.id, input.vendorId), eq(customers.orgId, actor.orgId)));
      if (!v) throw new InventoryError("Pick the vendor from the list.");
      vendorName = v.name;
    }
    const pkg = await createPackageInTx(tx, actor, { ...input, type: "RECEIVE", auditAction: "RECEIVE", auditExtra: vendorName ? { vendor: vendorName } : undefined });
    if (!input.vendorId) return pkg;
    const [withVendor] = await tx.update(packages).set({ vendorId: input.vendorId }).where(eq(packages.id, pkg.id)).returning();
    return withVendor;
  });
}

export async function movePackage(
  actor: Actor,
  input: { packageId: string; toLocationId: string; note?: string | null },
): Promise<Package> {
  return db.transaction(async (tx) => {
    const pkg = await lockPackage(tx, actor, input.packageId);
    assertEditable(pkg.status);
    if (!input.toLocationId) throw new InventoryError("Choose a location to move to.");
    if (pkg.locationId === input.toLocationId) throw new InventoryError("The package is already in that location.");
    await assertLocation(tx, actor, input.toLocationId);

    const [updated] = await tx
      .update(packages)
      .set({ locationId: input.toLocationId })
      .where(eq(packages.id, pkg.id))
      .returning();
    await tx.insert(inventoryTransactions).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      packageId: pkg.id,
      type: "MOVE",
      quantityDelta: "0",
      quantityBefore: pkg.quantity,
      quantityAfter: pkg.quantity,
      unit: pkg.unit,
      fromLocationId: pkg.locationId,
      toLocationId: input.toLocationId,
      note: input.note?.trim() || null,
      userId: actor.userId,
    });
    await audit(tx, actor, {
      entityType: "Package",
      entityId: pkg.id,
      action: "MOVE",
      before: snapshot(pkg),
      after: snapshot(updated),
      reason: input.note,
    });
    return updated;
  });
}

/** Set a package to a newly counted quantity. A reason code is required. */
export async function adjustPackage(
  actor: Actor,
  input: {
    packageId: string;
    newQuantity: unknown;
    reasonCode: string;
    note?: string | null;
    /** Undo only: a package emptied by the change being undone may be refilled, back to this status. */
    reopenAs?: PackageStatus;
  },
): Promise<Package> {
  if (!ADJUST_REASONS.some((r) => r.code === input.reasonCode)) {
    throw new InventoryError("Choose a reason for the adjustment.");
  }
  let target: Decimal;
  try {
    target = roundQty(new Decimal(String(input.newQuantity).trim()));
  } catch {
    throw new InventoryError("New quantity must be a number, for example 12.5.");
  }
  if (!target.isFinite() || target.lt(0)) throw new InventoryError("New quantity must be zero or more.");

  return db.transaction(async (tx) => {
    const pkg = await lockPackage(tx, actor, input.packageId);
    const reopening = Boolean(input.reopenAs) && pkg.status === "FINISHED";
    if (!reopening) assertEditable(pkg.status);
    assertNotAllocated(pkg);
    const change = applyDelta(pkg.quantity, target.sub(pkg.quantity));
    if (change.delta.isZero()) throw new InventoryError("The new quantity is the same as the current one.");

    const [updated] = await tx
      .update(packages)
      .set({ quantity: store(change.after), status: change.after.isZero() ? "FINISHED" : reopening ? input.reopenAs! : pkg.status })
      .where(eq(packages.id, pkg.id))
      .returning();
    await tx.insert(inventoryTransactions).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      packageId: pkg.id,
      type: "ADJUST",
      quantityDelta: store(change.delta),
      quantityBefore: store(change.before),
      quantityAfter: store(change.after),
      unit: pkg.unit,
      reasonCode: input.reasonCode,
      note: input.note?.trim() || null,
      userId: actor.userId,
    });
    await audit(tx, actor, {
      entityType: "Package",
      entityId: pkg.id,
      action: "ADJUST",
      before: snapshot(pkg),
      after: snapshot(updated),
      reason: [reasonLabel(input.reasonCode), input.note?.trim()].filter(Boolean).join(": "),
    });
    return updated;
  });
}

function assertActive(pkg: Package, verb: string) {
  if (pkg.status !== "ACTIVE") {
    throw new InventoryError(
      `Package ${pkg.tag} is ${pkg.status.replace("_", " ").toLowerCase()}, so it cannot be ${verb}. Release it first.`,
    );
  }
}

/** Carve new packages out of one package. The source keeps whatever is left. */
export async function splitPackageInTx(
  tx: Tx,
  actor: Actor,
  input: { packageId: string; parts: { tag: string; quantity: unknown }[]; note?: string | null },
): Promise<{ source: Package; children: Package[] }> {
  if (input.parts.length === 0) throw new InventoryError("Add at least one new package to split into.");
  const parts = input.parts.map((p) => ({ tag: normalizeTag(p.tag), quantity: p.quantity }));
  const tags = parts.map((p) => p.tag);
  if (new Set(tags).size !== tags.length) throw new InventoryError("Each new package needs a different tag.");

  {
    const source = await lockPackage(tx, actor, input.packageId);
    assertActive(source, "split");
    const plan = planSplit(source.quantity, parts.map((p) => p.quantity as Decimal.Value));

    const children = await tx
      .insert(packages)
      .values(
        parts.map((part, i) => ({
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          tag: part.tag,
          itemId: source.itemId,
          quantity: store(plan.parts[i]),
          unit: source.unit,
          locationId: source.locationId,
          lotNumber: source.lotNumber,
          costPerUnit: source.costPerUnit,
        })),
      )
      .onConflictDoNothing({ target: [packages.orgId, packages.tag] })
      .returning();
    if (children.length !== parts.length) {
      const made = new Set(children.map((c) => c.tag));
      const taken = tags.filter((t) => !made.has(t));
      throw new InventoryError(`Tag ${taken.join(", ")} is already in use. Nothing was split.`);
    }

    const [updatedSource] = await tx
      .update(packages)
      .set({ quantity: store(plan.remaining), status: plan.remaining.isZero() ? "FINISHED" : source.status })
      .where(eq(packages.id, source.id))
      .returning();

    const base = { orgId: actor.orgId, facilityId: actor.facilityId, unit: source.unit, userId: actor.userId, note: input.note?.trim() || null };
    await tx.insert(inventoryTransactions).values([
      {
        ...base,
        packageId: source.id,
        type: "SPLIT_OUT" as const,
        quantityDelta: store(plan.total.neg()),
        quantityBefore: source.quantity,
        quantityAfter: store(plan.remaining),
      },
      ...children.map((child) => ({
        ...base,
        packageId: child.id,
        type: "SPLIT_IN" as const,
        quantityDelta: child.quantity,
        quantityBefore: "0",
        quantityAfter: child.quantity,
        toLocationId: child.locationId,
      })),
    ]);
    await tx.insert(packageLineage).values(children.map((child) => ({ parentId: source.id, childId: child.id })));
    await audit(tx, actor, {
      entityType: "Package",
      entityId: source.id,
      action: "SPLIT",
      before: snapshot(source),
      after: { ...snapshot(updatedSource), into: children.map((c) => c.tag) },
      reason: input.note,
    });
    for (const child of children) {
      await audit(tx, actor, {
        entityType: "Package",
        entityId: child.id,
        action: "CREATED_BY_SPLIT",
        after: { ...snapshot(child), from: source.tag },
        reason: input.note,
      });
    }
    return { source: updatedSource, children };
  }
}

export async function splitPackage(
  actor: Actor,
  input: { packageId: string; parts: { tag: string; quantity: unknown }[]; note?: string | null },
): Promise<{ source: Package; children: Package[] }> {
  return db.transaction((tx) => splitPackageInTx(tx, actor, input));
}

/** Combine whole packages of the same item into one new package. */
export async function mergePackages(
  actor: Actor,
  input: { sourceIds: string[]; newTag: string; locationId?: string | null; note?: string | null },
): Promise<Package> {
  const newTag = normalizeTag(input.newTag);
  const ids = [...new Set(input.sourceIds)].sort();
  if (ids.length < 2) throw new InventoryError("Pick at least two different packages to merge.");

  return db.transaction(async (tx) => {
    // Sorted ids give every transaction the same lock order, which prevents deadlocks.
    const sources: Package[] = [];
    for (const id of ids) sources.push(await lockPackage(tx, actor, id));
    for (const source of sources) assertActive(source, "merged");
    const first = sources[0];
    if (sources.some((s) => s.itemId !== first.itemId || s.unit !== first.unit)) {
      throw new InventoryError("Only packages of the same item can be merged.");
    }
    if (sources.some((s) => (s.lotNumber ?? "") !== (first.lotNumber ?? ""))) {
      throw new InventoryError("These packages are from different lots. Merging them would lose lot traceability.");
    }
    const locationId = input.locationId || first.locationId;
    if (locationId) await assertLocation(tx, actor, locationId);

    const total = sources.reduce((sum, s) => sum.add(s.quantity), new Decimal(0));
    const cost = weightedAverageCost(sources.map((s) => ({ quantity: s.quantity, costPerUnit: s.costPerUnit })));

    const [merged] = await tx
      .insert(packages)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        tag: newTag,
        itemId: first.itemId,
        quantity: store(total),
        unit: first.unit,
        locationId,
        lotNumber: first.lotNumber,
        costPerUnit: cost ? store(cost) : null,
      })
      .onConflictDoNothing({ target: [packages.orgId, packages.tag] })
      .returning();
    if (!merged) throw new InventoryError(`Tag ${newTag} is already in use. Nothing was merged.`);

    await tx.update(packages).set({ quantity: "0", status: "FINISHED" }).where(inArray(packages.id, ids));

    const base = { orgId: actor.orgId, facilityId: actor.facilityId, unit: first.unit, userId: actor.userId, note: input.note?.trim() || null };
    await tx.insert(inventoryTransactions).values([
      ...sources.map((source) => ({
        ...base,
        packageId: source.id,
        type: "MERGE_OUT" as const,
        quantityDelta: store(new Decimal(source.quantity).neg()),
        quantityBefore: source.quantity,
        quantityAfter: "0",
      })),
      {
        ...base,
        packageId: merged.id,
        type: "MERGE_IN" as const,
        quantityDelta: store(total),
        quantityBefore: "0",
        quantityAfter: store(total),
        toLocationId: locationId,
      },
    ]);
    await tx.insert(packageLineage).values(sources.map((source) => ({ parentId: source.id, childId: merged.id })));
    for (const source of sources) {
      await audit(tx, actor, {
        entityType: "Package",
        entityId: source.id,
        action: "MERGED",
        before: snapshot(source),
        after: { ...snapshot({ ...source, quantity: "0", status: "FINISHED" }), into: merged.tag },
        reason: input.note,
      });
    }
    await audit(tx, actor, {
      entityType: "Package",
      entityId: merged.id,
      action: "CREATED_BY_MERGE",
      after: { ...snapshot(merged), from: sources.map((s) => s.tag) },
      reason: input.note,
    });
    return merged;
  });
}

function assertNotAllocated(pkg: Package) {
  if (pkg.status === "ALLOCATED") {
    throw new InventoryError(`Package ${pkg.tag} is set aside for a wholesale order. Release it from the order first.`);
  }
}

/** Set an active package aside for an order, or release it back to active stock. */
export async function setAllocatedInTx(tx: Tx, actor: Actor, pkg: Package, allocated: boolean, note: string): Promise<Package> {
  const status = allocated ? "ALLOCATED" : "ACTIVE";
  if (allocated && pkg.status !== "ACTIVE") {
    throw new InventoryError(`Package ${pkg.tag} is ${pkg.status.replace("_", " ").toLowerCase()} and cannot be put on an order.`);
  }
  if (!allocated && pkg.status !== "ALLOCATED") return pkg;
  // Start the hold clock when it first leaves active; keep it when switching between hold and quarantine.
  const heldSince = status === "ACTIVE" ? null : pkg.status === "ON_HOLD" || pkg.status === "QUARANTINE" ? (pkg.heldSince ?? new Date()) : new Date();
  const [updated] = await tx.update(packages).set({ status, heldSince }).where(eq(packages.id, pkg.id)).returning();
  await tx.insert(inventoryTransactions).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    packageId: pkg.id,
    type: "STATUS_CHANGE",
    quantityDelta: "0",
    quantityBefore: pkg.quantity,
    quantityAfter: pkg.quantity,
    unit: pkg.unit,
    note,
    userId: actor.userId,
  });
  await audit(tx, actor, {
    entityType: "Package",
    entityId: pkg.id,
    action: allocated ? "ALLOCATE" : "RELEASE_ALLOCATION",
    before: snapshot(pkg),
    after: snapshot(updated),
    reason: note,
  });
  return updated;
}

/** An allocated package leaves the building: its whole quantity is recorded as sold. */
export async function shipPackageInTx(tx: Tx, actor: Actor, packageId: string, note: string): Promise<Package> {
  const pkg = await lockPackage(tx, actor, packageId);
  if (pkg.status !== "ALLOCATED") {
    throw new InventoryError(`Package ${pkg.tag} is no longer set aside for this order. Check the order's packages and try again.`);
  }
  const [updated] = await tx.update(packages).set({ quantity: "0", status: "FINISHED" }).where(eq(packages.id, pkg.id)).returning();
  await tx.insert(inventoryTransactions).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    packageId: pkg.id,
    type: "SELL",
    quantityDelta: store(new Decimal(pkg.quantity).neg()),
    quantityBefore: pkg.quantity,
    quantityAfter: "0",
    unit: pkg.unit,
    note,
    userId: actor.userId,
  });
  await audit(tx, actor, {
    entityType: "Package",
    entityId: pkg.id,
    action: "SHIP",
    before: snapshot(pkg),
    after: snapshot(updated),
    reason: note,
  });
  return updated;
}

const HOLD_STATUSES = ["ACTIVE", "ON_HOLD", "QUARANTINE"] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

async function changeStatus(tx: Tx, actor: Actor, pkg: Package, status: HoldStatus, reason: string): Promise<Package> {
  // Start the hold clock when it first leaves active; keep it when switching between hold and quarantine.
  const heldSince = status === "ACTIVE" ? null : pkg.status === "ON_HOLD" || pkg.status === "QUARANTINE" ? (pkg.heldSince ?? new Date()) : new Date();
  const [updated] = await tx.update(packages).set({ status, heldSince }).where(eq(packages.id, pkg.id)).returning();
  await tx.insert(inventoryTransactions).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    packageId: pkg.id,
    type: "STATUS_CHANGE",
    quantityDelta: "0",
    quantityBefore: pkg.quantity,
    quantityAfter: pkg.quantity,
    unit: pkg.unit,
    note: `${pkg.status} → ${status}: ${reason}`,
    userId: actor.userId,
  });
  await audit(tx, actor, {
    entityType: "Package",
    entityId: pkg.id,
    action: status === "ACTIVE" ? "RELEASE" : status,
    before: snapshot(pkg),
    after: snapshot(updated),
    reason,
  });
  return updated;
}

/** Put a package on hold or in quarantine, or release it. A reason is always required. */
export async function setPackageStatus(
  actor: Actor,
  input: { packageId: string; status: string; reason: string },
): Promise<Package> {
  const status = input.status as HoldStatus;
  if (!HOLD_STATUSES.includes(status)) throw new InventoryError("Choose a status.");
  const reason = input.reason.trim();
  if (!reason) throw new InventoryError("Say why the status is changing. It goes in the audit trail.");
  return db.transaction(async (tx) => {
    const pkg = await lockPackage(tx, actor, input.packageId);
    assertEditable(pkg.status);
    assertNotAllocated(pkg);
    if (pkg.status === status) throw new InventoryError("The package already has that status.");
    return changeStatus(tx, actor, pkg, status, reason);
  });
}

/** Record destruction of everything left in a package. Cannot be undone. */
export async function destroyPackage(
  actor: Actor,
  input: { packageId: string; reason: string; mixedConfirmed?: boolean },
): Promise<Package> {
  const reason = input.reason.trim();
  if (!reason) throw new InventoryError("Say why and how the product was destroyed. It goes in the audit trail.");
  return db.transaction(async (tx) => {
    const pkg = await lockPackage(tx, actor, input.packageId);
    assertEditable(pkg.status);
    assertNotAllocated(pkg);
    await checkWasteRule(tx, actor, pkg, Boolean(input.mixedConfirmed));
    const [updated] = await tx
      .update(packages)
      .set({ quantity: "0", status: "DESTROYED" })
      .where(eq(packages.id, pkg.id))
      .returning();
    await tx.insert(inventoryTransactions).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      packageId: pkg.id,
      type: "DESTROY",
      quantityDelta: store(new Decimal(pkg.quantity).neg()),
      quantityBefore: pkg.quantity,
      quantityAfter: "0",
      unit: pkg.unit,
      note: reason,
      userId: actor.userId,
    });
    await audit(tx, actor, {
      entityType: "Package",
      entityId: pkg.id,
      action: "DESTROY",
      before: snapshot(pkg),
      after: snapshot(updated),
      reason,
    });
    return updated;
  });
}

/** The state's waste rule: a hold period first, and mixing to make it unusable. */
async function checkWasteRule(tx: Tx, actor: Actor, pkg: Package, mixedConfirmed: boolean) {
  const [facility] = await tx.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, actor.facilityId));
  const pack = packFor(facility?.state);
  const rule = wasteRule(pack);
  if (!pack || !rule) return;
  const heldFor = pkg.heldSince && (pkg.status === "ON_HOLD" || pkg.status === "QUARANTINE") ? Date.now() - pkg.heldSince.getTime() : -1;
  if (heldFor < rule.holdHours * 3_600_000) {
    const when =
      heldFor < 0
        ? "Put it on hold or in quarantine first."
        : `It can be destroyed after ${new Date(pkg.heldSince!.getTime() + rule.holdHours * 3_600_000).toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" })}.`;
    throw new InventoryError(`${pack.name} requires waste to be held for ${rule.holdHours} hours before it is destroyed. ${when}`);
  }
  if (!mixedConfirmed)
    throw new InventoryError(
      `${pack.name} requires waste to be made unusable by mixing it with at least ${rule.minMixPercent}% non-cannabis material. Confirm that this was done.`,
    );
}

/**
 * Save a cycle count for one location. Every package whose counted amount differs
 * from the system amount gets an adjustment with reason "Cycle count correction".
 */
export async function recordCycleCount(
  actor: Actor,
  input: { locationId: string; counts: { packageId: string; counted: unknown }[] },
): Promise<{ id: string; packagesCounted: number; variances: number }> {
  if (input.counts.length === 0) throw new InventoryError("There is nothing to count in this location.");
  const parsed = input.counts
    .map((line) => {
      let counted: Decimal;
      try {
        counted = roundQty(new Decimal(String(line.counted).trim()));
      } catch {
        throw new InventoryError("Every counted amount must be a number. Enter 0 if the package is empty or missing.");
      }
      if (!counted.isFinite() || counted.lt(0)) throw new InventoryError("Counted amounts must be zero or more.");
      return { packageId: line.packageId, counted };
    })
    .sort((a, b) => a.packageId.localeCompare(b.packageId));

  return db.transaction(async (tx) => {
    await assertLocation(tx, actor, input.locationId);
    const lines: { packageId: string; expected: string; counted: string }[] = [];
    let variances = 0;
    const [count] = await tx
      .insert(cycleCounts)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        locationId: input.locationId,
        userId: actor.userId,
        userName: actor.userName,
        packagesCounted: parsed.length,
        variances: 0,
      })
      .returning({ id: cycleCounts.id });

    for (const line of parsed) {
      const pkg = await lockPackage(tx, actor, line.packageId);
      if (pkg.locationId !== input.locationId) {
        throw new InventoryError(`Package ${pkg.tag} was moved out of this location during the count. Start the count again.`);
      }
      assertEditable(pkg.status);
      const change = applyDelta(pkg.quantity, line.counted.sub(pkg.quantity));
      lines.push({ packageId: pkg.id, expected: store(change.before), counted: store(change.after) });
      if (change.delta.isZero()) continue;
      assertNotAllocated(pkg);
      variances += 1;
      const [updated] = await tx
        .update(packages)
        .set({ quantity: store(change.after), status: change.after.isZero() ? "FINISHED" : pkg.status })
        .where(eq(packages.id, pkg.id))
        .returning();
      await tx.insert(inventoryTransactions).values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        packageId: pkg.id,
        type: "ADJUST",
        quantityDelta: store(change.delta),
        quantityBefore: store(change.before),
        quantityAfter: store(change.after),
        unit: pkg.unit,
        reasonCode: "COUNT_CORRECTION",
        note: `Cycle count ${count.id.slice(0, 8)}`,
        userId: actor.userId,
      });
      await audit(tx, actor, {
        entityType: "Package",
        entityId: pkg.id,
        action: "ADJUST",
        before: snapshot(pkg),
        after: snapshot(updated),
        reason: `Cycle count correction (count ${count.id.slice(0, 8)})`,
      });
    }

    await tx.insert(cycleCountLines).values(lines.map((line) => ({ countId: count.id, ...line })));
    await tx.update(cycleCounts).set({ variances }).where(eq(cycleCounts.id, count.id));
    await audit(tx, actor, {
      entityType: "CycleCount",
      entityId: count.id,
      action: "COMPLETE",
      after: { locationId: input.locationId, packagesCounted: parsed.length, variances },
    });
    return { id: count.id, packagesCounted: parsed.length, variances };
  });
}

const COA_TYPES = ["application/pdf", "image/png", "image/jpeg"];
export const COA_MAX_BYTES = 4 * 1024 * 1024;

function parsePercent(raw: unknown, what: string): string | null {
  const text = raw == null ? "" : String(raw).trim();
  if (text === "") return null;
  let value: Decimal;
  try {
    value = new Decimal(text);
  } catch {
    throw new InventoryError(`${what} must be a number between 0 and 100.`);
  }
  if (!value.isFinite() || value.lt(0) || value.gt(100)) throw new InventoryError(`${what} must be between 0 and 100.`);
  return value.toFixed(3);
}

/** Attach a lab result. A failing result quarantines the package automatically. */
export async function addLabResult(
  actor: Actor,
  input: {
    packageId: string;
    labName: string;
    status: string;
    sampleDate?: string | null;
    thcPercent?: unknown;
    cbdPercent?: unknown;
    notes?: string | null;
    coa?: { name: string; type: string; data: Buffer } | null;
  },
): Promise<{ id: string; quarantined: boolean }> {
  const labName = input.labName.trim();
  if (!labName) throw new InventoryError("Enter the name of the testing lab.");
  if (!["PENDING", "PASS", "FAIL"].includes(input.status)) throw new InventoryError("Choose a result: pending, pass, or fail.");
  const status = input.status as "PENDING" | "PASS" | "FAIL";
  const sampleDate = input.sampleDate?.trim() || null;
  if (sampleDate && !/^\d{4}-\d{2}-\d{2}$/.test(sampleDate)) throw new InventoryError("Sample date must be a valid date.");
  const thcPercent = parsePercent(input.thcPercent, "THC %");
  const cbdPercent = parsePercent(input.cbdPercent, "CBD %");
  const coa = input.coa ?? null;
  if (coa) {
    if (!COA_TYPES.includes(coa.type)) throw new InventoryError("The COA must be a PDF, PNG, or JPEG file.");
    if (coa.data.length > COA_MAX_BYTES) throw new InventoryError("The COA file is larger than 4 MB. Compress it and try again.");
  }

  return db.transaction(async (tx) => {
    const pkg = await lockPackage(tx, actor, input.packageId);
    const [result] = await tx
      .insert(labResults)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        packageId: pkg.id,
        labName,
        sampleDate,
        status,
        thcPercent,
        cbdPercent,
        notes: input.notes?.trim() || null,
        coaFileName: coa?.name.slice(0, 200) ?? null,
        coaMimeType: coa?.type ?? null,
        coaSize: coa?.data.length ?? null,
        coaData: coa?.data ?? null,
        userId: actor.userId,
      })
      .returning({ id: labResults.id });
    await audit(tx, actor, {
      entityType: "Package",
      entityId: pkg.id,
      action: "LAB_RESULT",
      after: { labName, status, thcPercent, cbdPercent, sampleDate, coaFileName: coa?.name ?? null },
    });
    let quarantined = false;
    if (status === "FAIL" && (pkg.status === "ACTIVE" || pkg.status === "ON_HOLD")) {
      await changeStatus(tx, actor, pkg, "QUARANTINE", `Failed lab test at ${labName}`);
      quarantined = true;
    }
    return { id: result.id, quarantined };
  });
}
