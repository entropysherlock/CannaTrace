import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, customers, facilities, items, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { audit, createPackageInTx, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
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
  const unknown = lines.filter((l) => !l.item && l.status !== "MISSING");
  if (unknown.length)
    problems.push(
      `${unknown.length} product${unknown.length === 1 ? " isn't" : "s aren't"} in CannaTrace yet (${unknown
        .slice(0, 5)
        .map((l) => l.product)
        .join(", ")}${unknown.length > 5 ? ", …" : ""}). Add ${unknown.length === 1 ? "it" : "them"} in Catalog with the same name or SKU, then check again.`,
    );

  // Tags already in use anywhere in the business
  const tags = lines.filter((l) => l.status !== "MISSING").map((l) => l.tag);
  if (tags.length) {
    const taken = await db
      .select({ tag: packages.tag })
      .from(packages)
      .where(and(eq(packages.orgId, actor.orgId), inArray(packages.tag, tags)));
    for (const t of taken) problems.push(`${t.tag} is already in CannaTrace. A package can only be received once.`);
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
