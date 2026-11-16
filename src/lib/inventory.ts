import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { auditLogs, inventoryTransactions, items, locations, packages, type Package, type PackageStatus } from "@/db/schema";
import { db, type Tx } from "./db";
import { InventoryError, applyDelta, parsePositiveQty } from "./inventory-math";
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

async function audit(
  tx: Tx,
  actor: Actor,
  entry: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown; reason?: string | null },
) {
  await tx.insert(auditLogs).values({
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
  });
}

/** Lock the package row for the rest of the transaction so two edits cannot interleave. */
async function lockPackage(tx: Tx, actor: Actor, packageId: string): Promise<Package> {
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

async function assertLocation(tx: Tx, actor: Actor, locationId: string) {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.orgId, actor.orgId), eq(locations.facilityId, actor.facilityId)));
  if (!location) throw new InventoryError("That location does not exist at this facility.");
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
  },
): Promise<Package> {
  const tag = input.tag.trim().toUpperCase();
  if (!tag) throw new InventoryError("Scan or type a package tag.");
  const quantity = parsePositiveQty(input.quantity);
  const costText = input.costPerUnit == null ? "" : String(input.costPerUnit).trim();
  const cost = costText === "" ? null : parsePositiveQty(costText, "Cost per unit");

  return db.transaction(async (tx) => {
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
      type: "RECEIVE",
      quantityDelta: store(quantity),
      quantityBefore: "0",
      quantityAfter: store(quantity),
      unit: item.unit,
      toLocationId: input.locationId,
      note: input.note?.trim() || null,
      userId: actor.userId,
    });
    await audit(tx, actor, { entityType: "Package", entityId: pkg.id, action: "RECEIVE", after: snapshot(pkg), reason: input.note });
    return pkg;
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
  input: { packageId: string; newQuantity: unknown; reasonCode: string; note?: string | null },
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
    assertEditable(pkg.status);
    const change = applyDelta(pkg.quantity, target.sub(pkg.quantity));
    if (change.delta.isZero()) throw new InventoryError("The new quantity is the same as the current one.");

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
