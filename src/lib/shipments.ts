import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, customers, facilities, inventoryTransactions, items, orderAllocations, orders, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { audit, createPackageInTx, type Actor } from "@/lib/inventory";
import Decimal from "decimal.js";
import { assertWholeForUnit, InventoryError } from "@/lib/inventory-math";
import { SYSTEM_LABELS, type SystemName } from "@/lib/sync-math";
import { parseManifest, reviewShipment, type Received, type ReviewLine } from "@/lib/shipments-parse";

/**
 * Receiving a whole shipment against its manifest. This is not a migration (that's the Dutchie, Flourish,
 * and NMS2S importers): it's new stock arriving from another licensee.
 * - Checked in full first: every product must already be in CannaTrace, no tag may be in use, and the same
 *   manifest can't be received twice at a facility.
 * - The receiver reviews every difference: short and missing lines need a reason; more than the manifest
 *   lists is refused.
 * - Saved together or not at all, with each package in the audit trail and one Shipment entry listing
 *   expected against received.
 * - State reporting: one record for the whole manifest (accept it, with what was short or rejected), the
 *   way the state system expects, not one record per package.
 */

export type ShipmentResult = {
  manifestNumber: string;
  lines: (ReviewLine & { itemName: string | null })[];
  problems: string[];
  accepted: number;
  short: number;
  rejected: number;
  received: boolean;
  /** Where the state record goes, for the confirmation message. */
  stateSystem: string;
};

export async function receiveShipment(
  actor: Actor,
  input: { manifestNumber: string; table: string[][]; locationId: string; vendorId?: string | null; received: Record<string, Received>; commit: boolean },
): Promise<ShipmentResult> {
  const manifestNumber = input.manifestNumber.trim().toUpperCase().slice(0, 60);
  const parsed = parseManifest(input.table);
  const reviewed = reviewShipment(parsed.lines, input.received);
  const problems = [...parsed.problems, ...reviewed.problems];
  if (!manifestNumber) problems.unshift("Enter the manifest number from the paperwork.");
  if (!input.locationId) problems.push("Choose where the shipment is put away.");

  const [facility] = await db.select({ system: facilities.trackTraceSystem }).from(facilities).where(eq(facilities.id, actor.facilityId));
  const stateSystem = SYSTEM_LABELS[(facility?.system ?? "MOCK") as SystemName];

  // Every product must already be in CannaTrace, matched by SKU, then by exact name.
  const catalog = await db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .where(and(eq(items.orgId, actor.orgId), eq(items.active, true)));
  const itemFor = (l: ReviewLine) =>
    (l.sku ? catalog.find((i) => i.sku === l.sku!.toUpperCase()) : undefined) ?? catalog.find((i) => i.name.toLowerCase() === l.product.toLowerCase());
  const lines = reviewed.lines.map((l) => ({ ...l, item: itemFor(l) }));
  const unitOf = new Map((await db.select({ id: items.id, unit: items.unit }).from(items).where(eq(items.orgId, actor.orgId))).map((i) => [i.id, i.unit]));
  for (const l of lines) {
    if (l.status === "MISSING" || !l.item) continue;
    try {
      assertWholeForUnit(unitOf.get(l.item.id) ?? "G", l.received, `${l.tag}: quantity received`);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  const unknown = lines.filter((l) => !l.item && l.status !== "MISSING");
  if (unknown.length)
    problems.push(
      `${unknown.length} product${unknown.length === 1 ? " isn't" : "s aren't"} in CannaTrace yet (${unknown
        .slice(0, 5)
        .map((l) => l.product)
        .join(", ")}${unknown.length > 5 ? ", …" : ""}). Add ${unknown.length === 1 ? "it" : "them"} in Catalog with the same name or SKU, then check again.`,
    );

  // Tags already in use anywhere in the business. The one exception is a transfer between this business's own
  // facilities: a package another facility shipped on this same manifest is taken in here (moved), not created twice.
  const tags = lines.filter((l) => l.status !== "MISSING").map((l) => l.tag);
  const transfers = new Map<string, { id: string; itemId: string }>();
  if (tags.length) {
    const taken = await db
      .select({ id: packages.id, tag: packages.tag, itemId: packages.itemId, facilityId: packages.facilityId, status: packages.status, quantity: packages.quantity })
      .from(packages)
      .where(and(eq(packages.orgId, actor.orgId), inArray(packages.tag, tags)));
    const shipped = taken.length
      ? await db
          .select({ packageId: orderAllocations.packageId })
          .from(orderAllocations)
          .innerJoin(orders, eq(orders.id, orderAllocations.orderId))
          .where(
            and(
              eq(orders.orgId, actor.orgId),
              eq(orders.manifestNumber, manifestNumber),
              inArray(orders.status, ["SHIPPED", "DELIVERED"]),
              inArray(
                orderAllocations.packageId,
                taken.map((t) => t.id),
              ),
            ),
          )
      : [];
    const onManifest = new Set(shipped.map((r) => r.packageId));
    for (const t of taken) {
      if (onManifest.has(t.id) && t.facilityId !== actor.facilityId && t.status === "FINISHED" && Number(t.quantity) === 0) transfers.set(t.tag, { id: t.id, itemId: t.itemId });
      else problems.push(`${t.tag} is already in CannaTrace. A package can only be received once.`);
    }
    for (const l of lines) {
      const moved = transfers.get(l.tag);
      if (moved && l.item && l.item.id !== moved.itemId) problems.push(`${l.tag} was shipped as a different product than "${l.product}". Check the manifest.`);
    }
  }

  // The vendor, when given, must be one this business buys from
  let vendor: { id: string; name: string } | null = null;
  if (input.vendorId) {
    const [v] = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, input.vendorId), eq(customers.orgId, actor.orgId)));
    if (!v) problems.push("Pick the vendor from the list.");
    vendor = v ?? null;
  }

  const received = async (ex: Pick<typeof db, "select">) =>
    (
      await ex
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.orgId, actor.orgId),
            eq(auditLogs.facilityId, actor.facilityId),
            eq(auditLogs.entityType, "Shipment"),
            eq(auditLogs.entityId, manifestNumber),
            eq(auditLogs.action, "RECEIVE"),
          ),
        )
        .limit(1)
    ).length > 0;
  if (manifestNumber && (await received(db))) problems.unshift(`Manifest ${manifestNumber} was already received at this facility.`);

  const counts = {
    accepted: lines.filter((l) => l.status !== "MISSING").length,
    short: lines.filter((l) => l.status === "SHORT").length,
    rejected: lines.filter((l) => l.status === "MISSING").length,
  };
  const result: ShipmentResult = {
    manifestNumber,
    lines: lines.map(({ item, ...l }) => ({ ...l, itemName: item?.name ?? null })),
    problems,
    ...counts,
    received: false,
    stateSystem,
  };
  if (!input.commit || problems.length) return result;
  if (!counts.accepted) throw new InventoryError("Nothing on this manifest arrived, so there's nothing to receive. Record the refusal in the state system.");

  await db.transaction(async (tx) => {
    // One receipt per manifest at a time: a double-click or two people can't receive it twice.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`shipment:${actor.facilityId}:${manifestNumber}`}, 0))`);
    if (await received(tx)) throw new InventoryError(`Manifest ${manifestNumber} was already received at this facility.`);
    for (const l of lines) {
      if (l.status === "MISSING" || !l.item) continue;
      const moved = transfers.get(l.tag);
      if (moved) {
        await takeInTransferInTx(tx, actor, { packageId: moved.id, quantity: l.received, locationId: input.locationId, manifestNumber, expected: l.quantity, reason: l.reason });
        continue;
      }
      const pkg = await createPackageInTx(tx, actor, {
        tag: l.tag,
        itemId: l.item.id,
        quantity: l.received,
        locationId: input.locationId,
        lotNumber: l.lot,
        costPerUnit: l.cost,
        note: `Manifest ${manifestNumber}`,
        type: "RECEIVE",
        // Not "RECEIVE": the state hears about the shipment once, below, not package by package.
        auditAction: "RECEIVE_SHIPMENT",
        auditExtra: { manifestNumber, vendor: vendor?.name ?? null, expected: l.quantity, ...(l.reason ? { shortReason: l.reason } : {}) },
      });
      if (vendor) await tx.update(packages).set({ vendorId: vendor.id }).where(eq(packages.id, pkg.id));
    }
    await audit(tx, actor, {
      entityType: "Shipment",
      entityId: manifestNumber,
      action: "RECEIVE",
      after: {
        manifestNumber,
        vendor: vendor?.name ?? null,
        ...counts,
        lines: lines.map((l) => ({ tag: l.tag, product: l.product, expected: l.quantity, received: l.received, status: l.status, reason: l.reason })),
      },
    });
  });
  return { ...result, received: true };
}

/**
 * Take in a package another of this business's facilities shipped on this manifest: the same package (tag, lot,
 * lab results, lineage) moves to this facility with what arrived, instead of a second package with the same tag.
 */
async function takeInTransferInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actor: Actor,
  input: { packageId: string; quantity: string; locationId: string; manifestNumber: string; expected: string; reason?: string | null },
) {
  const [pkg] = await tx.select().from(packages).where(and(eq(packages.id, input.packageId), eq(packages.orgId, actor.orgId))).for("update");
  if (!pkg || pkg.status !== "FINISHED" || Number(pkg.quantity) !== 0) throw new InventoryError(`${pkg?.tag ?? "A package"} changed while receiving. Check the manifest again.`);
  const [location] = await tx.execute(sql`select 1 from locations where id = ${input.locationId} and facility_id = ${actor.facilityId}`).then((r) => r.rows);
  if (!location) throw new InventoryError("Choose where the shipment is put away.");
  const quantity = new Decimal(input.quantity).toFixed(4);
  const [after] = await tx
    .update(packages)
    .set({ facilityId: actor.facilityId, locationId: input.locationId, quantity, status: "ACTIVE", heldSince: null })
    .where(eq(packages.id, pkg.id))
    .returning();
  await tx.insert(inventoryTransactions).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    packageId: pkg.id,
    type: "RECEIVE",
    quantityDelta: quantity,
    quantityBefore: "0",
    quantityAfter: quantity,
    unit: pkg.unit,
    toLocationId: input.locationId,
    note: `Manifest ${input.manifestNumber} (transfer from another of our facilities)`,
    userId: actor.userId,
  });
  await audit(tx, actor, {
    entityType: "Package",
    entityId: pkg.id,
    action: "RECEIVE_SHIPMENT",
    before: { tag: pkg.tag, facilityId: pkg.facilityId, status: pkg.status, quantity: pkg.quantity },
    after: { tag: after.tag, quantity: after.quantity, unit: after.unit, status: after.status, locationId: after.locationId, manifestNumber: input.manifestNumber, transfer: true, expected: input.expected, ...(input.reason ? { shortReason: input.reason } : {}) },
    reason: `Manifest ${input.manifestNumber}`,
  });
}
