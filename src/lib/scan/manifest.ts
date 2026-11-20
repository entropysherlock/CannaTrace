import "server-only";
import Decimal from "decimal.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { customers, items, locations, packages, scanReads } from "@/db/schema";
import { db } from "@/lib/db";
import { createPackageInTx, type Actor } from "@/lib/inventory";
import { InventoryError, normalizeTag } from "@/lib/inventory-math";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { getScan } from "./read";
import { matchItem, matchVendor } from "./manifest-math";
import type { DocProposal } from "./types";

export const MANIFEST_LINE_LIMIT = 200;

export type ManifestContext = {
  items: { id: string; label: string }[];
  locations: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  vendorId: string;
  lines: { tag: string; product: string; quantity: string; unit: string; lot: string; itemId: string; existing: boolean }[];
};

/** Everything the manifest review needs: the choices, and a first guess for each line that the person then checks. */
export async function manifestContext(session: Session, proposal: DocProposal): Promise<ManifestContext> {
  const [itemRows, locationRows, vendorRows] = await Promise.all([
    db.select({ id: items.id, name: items.name, sku: items.sku, unit: items.unit }).from(items).where(and(eq(items.orgId, session.orgId), eq(items.active, true))).orderBy(asc(items.name)).limit(3000),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId))).orderBy(asc(locations.name)),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.orgId, session.orgId), eq(customers.active, true), eq(customers.weBuyFrom, true))).orderBy(asc(customers.name)),
  ]);
  const tags = proposal.items.map((r) => normalizeTag(r.packageTag ?? "")).filter(Boolean);
  const taken = tags.length ? await db.select({ tag: packages.tag }).from(packages).where(and(eq(packages.orgId, session.orgId), inArray(packages.tag, tags))) : [];
  const takenSet = new Set(taken.map((t) => t.tag));
  const sender = proposal.fields.find((f) => f.key === "sender")?.value ?? "";
  return {
    items: itemRows.map((i) => ({ id: i.id, label: `${i.name} (${unitLabel(i.unit)})` })),
    locations: locationRows,
    vendors: vendorRows,
    vendorId: matchVendor(sender, vendorRows)?.id ?? "",
    lines: proposal.items.slice(0, MANIFEST_LINE_LIMIT).map((r) => {
      const tag = normalizeTag(r.packageTag ?? "");
      return {
        tag,
        product: r.product ?? "",
        quantity: r.quantity ?? "",
        unit: r.unit ?? "",
        lot: r.lotNumber ?? "",
        itemId: matchItem(r.product ?? "", itemRows)?.id ?? "",
        existing: Boolean(tag && takenSet.has(tag)),
      };
    }),
  };
}

export type ManifestLine = { tag: string; itemId: string; quantity: string; lot: string };

/** Receive every ticked line as its own package, together or not at all, then mark the manifest done. */
export async function receiveManifest(session: Session, input: { attachmentId: string; locationId: string; vendorId: string; lines: ManifestLine[] }): Promise<{ count: number }> {
  if (!can(session, "inventory.write")) throw new InventoryError("Your role can't receive inventory.");
  const scan = await getScan(session, input.attachmentId);
  if (!scan || scan.proposal.kind !== "DOC" || scan.proposal.docType !== "MANIFEST") throw new InventoryError("That manifest hasn't been read yet.");
  if (scan.status === "APPLIED") throw new InventoryError("This manifest was already received.");
  const lines = input.lines;
  if (!lines.length) throw new InventoryError("Tick at least one package to receive.");
  if (lines.length > MANIFEST_LINE_LIMIT) throw new InventoryError(`Receive at most ${MANIFEST_LINE_LIMIT} packages at a time.`);
  if (!input.locationId) throw new InventoryError("Choose where the packages are put away.");
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (!l.itemId) throw new InventoryError(`Line ${i + 1}: pick the item it is.`);
    const tag = normalizeTag(l.tag);
    if (tag && seen.has(tag)) throw new InventoryError(`Line ${i + 1}: tag ${tag} is on more than one line. Every package needs its own tag.`);
    if (tag) seen.add(tag);
    try {
      if (new Decimal(l.quantity || "x").lte(0)) throw new Error();
    } catch {
      throw new InventoryError(`Line ${i + 1}: enter how many arrived.`);
    }
  });
  const number = scan.proposal.fields.find((f) => f.key === "manifestNumber")?.value;
  const note = number ? `Received from manifest ${number}` : "Received from a manifest";
  const actor: Actor = { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };

  await db.transaction(async (tx) => {
    if (input.vendorId) {
      const [v] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.vendorId), eq(customers.orgId, actor.orgId)));
      if (!v) throw new InventoryError("Pick the vendor from the list.");
    }
    for (const [i, l] of lines.entries()) {
      try {
        const pkg = await createPackageInTx(tx, actor, { tag: l.tag || null, itemId: l.itemId, quantity: l.quantity, locationId: input.locationId, lotNumber: l.lot || null, note, type: "RECEIVE", auditAction: "RECEIVE", auditExtra: { manifest: number ?? null } });
        if (input.vendorId) await tx.update(packages).set({ vendorId: input.vendorId }).where(eq(packages.id, pkg.id));
      } catch (e) {
        if (e instanceof InventoryError) throw new InventoryError(`Line ${i + 1}: ${e.message} Nothing was received.`);
        throw e;
      }
    }
    await tx.update(scanReads).set({ status: "APPLIED", resultRef: `RECEIVED:${lines.length}`, appliedAt: new Date() }).where(eq(scanReads.id, scan.id));
  });
  return { count: lines.length };
}
