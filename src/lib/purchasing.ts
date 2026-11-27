import "server-only";
import Decimal from "decimal.js";
import { and, asc, eq, sql } from "drizzle-orm";
import { customers, items, packages, purchaseOrderLines, purchaseOrderReceipts, purchaseOrders, type Package, type PurchaseOrder } from "@/db/schema";
import { readTable } from "./csv";
import { db, type Tx } from "./db";
import { audit, createPackageInTx, type Actor } from "./inventory";
import { InventoryError, assertWholeForUnit, parseCost, parsePositiveQty, storeCost } from "./inventory-math";
import { nextNumber } from "./numbering";
import { editable, matchItem, receivable, remaining, statusAfterReceiving, type PoStatus } from "./purchasing-math";
import { facilityToday } from "./time";

/**
 * Purchase orders: what a facility ordered from a vendor, then received against as it arrives.
 * Receiving makes ordinary packages through the same path as the Receive screen (tags, cost, state
 * reporting, audit), and each one is tied back to its PO line so the PO always shows what is still due.
 */

const store = (v: Decimal) => v.toFixed(4);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function vendorFor(tx: Tx, actor: Actor, vendorId: string) {
  if (!vendorId) throw new InventoryError("Pick the vendor you are buying from.");
  const [v] = await tx.select().from(customers).where(and(eq(customers.id, vendorId), eq(customers.orgId, actor.orgId)));
  if (!v) throw new InventoryError("Pick the vendor from the list.");
  if (!v.active) throw new InventoryError(`${v.name} is marked inactive.`);
  if (!v.weBuyFrom) throw new InventoryError(`${v.name} is not set up as a vendor you buy from. Turn on "We buy from them" on their page first.`);
  return v;
}

async function lockPo(tx: Tx, actor: Actor, poId: string): Promise<PurchaseOrder> {
  const [po] = await tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, actor.orgId), eq(purchaseOrders.facilityId, actor.facilityId)))
    .for("update");
  if (!po) throw new InventoryError("That purchase order was not found at this facility.");
  return po;
}

function cleanExpected(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T12:00:00Z`))) throw new InventoryError("Expected date must be a valid date.");
  return s;
}

function cleanCost(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim().replace(/^\$/, "");
  return s ? storeCost(parseCost(s, "Cost per unit")) : null;
}

export async function createPurchaseOrder(actor: Actor, input: { vendorId: string; expectedOn?: unknown; notes?: unknown }): Promise<PurchaseOrder> {
  const expectedOn = cleanExpected(input.expectedOn);
  return db.transaction(async (tx) => {
    const vendor = await vendorFor(tx, actor, input.vendorId);
    const number = await nextNumber(tx, actor.facilityId, "PO");
    const [po] = await tx
      .insert(purchaseOrders)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, number, vendorId: vendor.id, expectedOn, notes: text(input.notes, 500), userName: actor.userName })
      .returning();
    await audit(tx, actor, { entityType: "PurchaseOrder", entityId: po.id, action: "CREATE", after: { number, vendor: vendor.name, expectedOn } });
    return po;
  });
}

async function addLineInTx(tx: Tx, actor: Actor, po: PurchaseOrder, input: { itemId: string; quantity: unknown; unitCost?: unknown }) {
  const quantity = parsePositiveQty(input.quantity);
  const [item] = await tx.select().from(items).where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId), eq(items.active, true)));
  if (!item) throw new InventoryError("Pick an item from the list.");
  assertWholeForUnit(item.unit, quantity);
  const unitCost = cleanCost(input.unitCost);
  const [line] = await tx
    .insert(purchaseOrderLines)
    .values({ purchaseOrderId: po.id, itemId: item.id, quantity: store(quantity), unitCost })
    .onConflictDoNothing({ target: [purchaseOrderLines.purchaseOrderId, purchaseOrderLines.itemId] })
    .returning({ id: purchaseOrderLines.id });
  if (!line) throw new InventoryError(`${item.name} is already on this purchase order. Remove that line first to change it.`);
  await audit(tx, actor, { entityType: "PurchaseOrder", entityId: po.id, action: "ADD_LINE", after: { item: item.name, quantity: quantity.toString(), unitCost } });
}

export async function addPurchaseOrderLine(actor: Actor, input: { purchaseOrderId: string; itemId: string; quantity: unknown; unitCost?: unknown }): Promise<void> {
  await db.transaction(async (tx) => {
    const po = await lockPo(tx, actor, input.purchaseOrderId);
    if (!editable(po.status)) throw new InventoryError(`${po.number} is ${po.status.toLowerCase()}, so its lines can't change.`);
    await addLineInTx(tx, actor, po, input);
  });
}

export async function removePurchaseOrderLine(actor: Actor, input: { lineId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, input.lineId));
    if (!line) throw new InventoryError("That line was already removed.");
    const po = await lockPo(tx, actor, line.purchaseOrderId);
    if (!editable(po.status)) throw new InventoryError(`${po.number} is ${po.status.toLowerCase()}, so its lines can't change.`);
    if (new Decimal(line.quantityReceived).gt(0)) throw new InventoryError("Part of that line was already received, so it can't be removed.");
    const [item] = await tx.select({ name: items.name }).from(items).where(eq(items.id, line.itemId));
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.id, line.id));
    await audit(tx, actor, { entityType: "PurchaseOrder", entityId: po.id, action: "REMOVE_LINE", before: { item: item?.name ?? null, quantity: line.quantity } });
  });
}

/** Mark sent to the vendor, cancel, or close a partly received PO short (nothing more is coming). */
export async function changePurchaseOrder(actor: Actor, input: { purchaseOrderId: string; step: string }): Promise<PurchaseOrder> {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, actor, input.purchaseOrderId);
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    let next: PoStatus;
    if (input.step === "send") {
      if (po.status !== "DRAFT") throw new InventoryError(`${po.number} was already sent.`);
      if (!lines.length) throw new InventoryError("Add at least one line before sending it to the vendor.");
      next = "SENT";
    } else if (input.step === "cancel") {
      if (!editable(po.status)) throw new InventoryError(`${po.number} is ${po.status.toLowerCase()}. Only a PO with nothing received can be cancelled; close it short instead.`);
      next = "CANCELLED";
    } else if (input.step === "close") {
      if (po.status !== "PARTIAL") throw new InventoryError("Only a partly received purchase order can be closed short.");
      next = "RECEIVED";
    } else {
      throw new InventoryError("Unknown step.");
    }
    const [updated] = await tx
      .update(purchaseOrders)
      .set({ status: next, ...(next === "SENT" ? { sentAt: new Date() } : { closedAt: new Date() }) })
      .where(eq(purchaseOrders.id, po.id))
      .returning();
    const action = input.step === "send" ? "SEND" : input.step === "cancel" ? "CANCEL" : "CLOSE_SHORT";
    await audit(tx, actor, { entityType: "PurchaseOrder", entityId: po.id, action, before: { number: po.number, status: po.status }, after: { number: po.number, status: next } });
    return updated;
  });
}

export type ReceiveLine = { lineId: string; quantity: unknown; tag?: string | null; lotNumber?: string | null };

/**
 * Receive what arrived against a PO: one new package per line, all in one save or none. Each package
 * gets the PO's vendor and the line's cost. Leave quantity blank or 0 to skip a line this time.
 */
export async function receivePurchaseOrder(
  actor: Actor,
  input: { purchaseOrderId: string; locationId: string; lines: ReceiveLine[]; note?: string | null },
): Promise<{ po: PurchaseOrder; packages: Package[] }> {
  if (!input.locationId) throw new InventoryError("Choose where the packages are put away.");
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, actor, input.purchaseOrderId);
    if (!receivable(po.status)) throw new InventoryError(`${po.number} is ${po.status.toLowerCase()}, so nothing more can be received on it.`);
    const [vendor] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, po.vendorId));
    const lines = await tx
      .select({ line: purchaseOrderLines, itemName: items.name })
      .from(purchaseOrderLines)
      .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
      .where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const byId = new Map(lines.map((l) => [l.line.id, l]));
    const made: Package[] = [];
    const tags = new Set<string>();
    for (const r of input.lines) {
      const raw = String(r.quantity ?? "").trim();
      if (!raw || Number(raw) === 0) continue;
      const found = byId.get(r.lineId);
      if (!found) throw new InventoryError("A line on this receipt is not on the purchase order. Reload the page. Nothing was received.");
      const quantity = parsePositiveQty(raw);
      const left = remaining(found.line);
      if (quantity.gt(left)) {
        throw new InventoryError(`${found.itemName}: ${quantity} is more than the ${left} still due on ${po.number}. Nothing was received. Add a line or fix the count.`);
      }
      const tag = r.tag?.trim() || null;
      if (tag) {
        if (tags.has(tag.toUpperCase())) throw new InventoryError(`Tag ${tag} is used twice on this receipt. Every package needs its own tag.`);
        tags.add(tag.toUpperCase());
      }
      const pkg = await createPackageInTx(tx, actor, {
        tag,
        itemId: found.line.itemId,
        quantity: quantity.toString(),
        locationId: input.locationId,
        lotNumber: r.lotNumber?.trim() || null,
        costPerUnit: found.line.unitCost,
        note: `Purchase order ${po.number}${input.note?.trim() ? `: ${input.note.trim()}` : ""}`,
        type: "RECEIVE",
        auditAction: "RECEIVE",
        auditExtra: { vendor: vendor?.name ?? null, purchaseOrder: po.number },
      });
      const [withVendor] = await tx.update(packages).set({ vendorId: po.vendorId }).where(eq(packages.id, pkg.id)).returning();
      await tx.insert(purchaseOrderReceipts).values({ purchaseOrderLineId: found.line.id, packageId: pkg.id, quantity: store(quantity), userName: actor.userName });
      const received = new Decimal(found.line.quantityReceived).add(quantity);
      await tx.update(purchaseOrderLines).set({ quantityReceived: store(received) }).where(eq(purchaseOrderLines.id, found.line.id));
      found.line.quantityReceived = store(received);
      made.push(withVendor);
    }
    if (!made.length) throw new InventoryError("Enter how much arrived on at least one line.");
    const next = statusAfterReceiving(
      lines.map((l) => l.line),
      po.status === "DRAFT" ? "SENT" : po.status,
    );
    const [updated] = await tx
      .update(purchaseOrders)
      .set({ status: next, ...(po.status === "DRAFT" ? { sentAt: new Date() } : {}), ...(next === "RECEIVED" ? { closedAt: new Date() } : {}) })
      .where(eq(purchaseOrders.id, po.id))
      .returning();
    await audit(tx, actor, {
      entityType: "PurchaseOrder",
      entityId: po.id,
      action: "RECEIVE",
      before: { number: po.number, status: po.status },
      after: { number: po.number, status: next, packages: made.map((p) => p.tag) },
    });
    return { po: updated, packages: made };
  });
}

/** Receive everything still due, one package per line with generated tags: Flourish's "receive the whole PO in one click". */
export async function receiveWholePurchaseOrder(actor: Actor, input: { purchaseOrderId: string; locationId: string; note?: string | null }) {
  const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, input.purchaseOrderId));
  const due = lines.map((l) => ({ lineId: l.id, quantity: remaining(l).toString() })).filter((l) => l.quantity !== "0");
  if (!due.length) throw new InventoryError("Everything on this purchase order has been received.");
  return receivePurchaseOrder(actor, { ...input, lines: due });
}

export const PO_IMPORT_COLUMNS = { required: ["quantity"], optional: ["sku", "item", "unit cost"] };

/**
 * Make a draft PO from a spreadsheet: one row per product, matched by SKU or exact item name, with
 * quantity and an optional unit cost. Every row is checked first; one bad row means nothing is saved.
 */
export async function importPurchaseOrder(
  actor: Actor,
  input: { vendorId: string; csv: string; expectedOn?: unknown; notes?: unknown },
): Promise<{ po: PurchaseOrder; lines: number }> {
  const rows = readTable(input.csv, PO_IMPORT_COLUMNS.required, PO_IMPORT_COLUMNS.optional);
  if (!rows.length) throw new InventoryError("The file has a header row but no products under it.");
  const catalog = await db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .where(and(eq(items.orgId, actor.orgId), eq(items.active, true)))
    .orderBy(asc(items.name));
  const problems: string[] = [];
  const parsed: { itemId: string; quantity: string; unitCost: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const label = r.values.sku || r.values.item || "(blank)";
    if (!r.values.sku && !r.values.item) {
      problems.push(`Row ${r.line}: give a sku or an item name.`);
      continue;
    }
    const item = matchItem({ sku: r.values.sku, item: r.values.item }, catalog);
    if (!item) {
      problems.push(`Row ${r.line}: no single item matches "${label}". Use the SKU from the Items page.`);
      continue;
    }
    if (seen.has(item.id)) {
      problems.push(`Row ${r.line}: ${item.name} is listed twice. Put it on one row.`);
      continue;
    }
    seen.add(item.id);
    try {
      parsePositiveQty(r.values.quantity);
      if (r.values["unit cost"]) cleanCost(r.values["unit cost"]);
    } catch (error) {
      problems.push(`Row ${r.line}: ${error instanceof Error ? error.message : "bad number"}`);
      continue;
    }
    parsed.push({ itemId: item.id, quantity: r.values.quantity, unitCost: r.values["unit cost"] });
  }
  if (problems.length) {
    const shown = problems.slice(0, 8).join(" ");
    throw new InventoryError(`Nothing was saved. ${shown}${problems.length > 8 ? ` …and ${problems.length - 8} more.` : ""}`);
  }
  const expectedOn = cleanExpected(input.expectedOn);
  return db.transaction(async (tx) => {
    const vendor = await vendorFor(tx, actor, input.vendorId);
    const number = await nextNumber(tx, actor.facilityId, "PO");
    const [po] = await tx
      .insert(purchaseOrders)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, number, vendorId: vendor.id, expectedOn, notes: text(input.notes, 500), userName: actor.userName })
      .returning();
    await audit(tx, actor, { entityType: "PurchaseOrder", entityId: po.id, action: "CREATE", after: { number, vendor: vendor.name, expectedOn, importedRows: parsed.length } });
    for (const p of parsed) await addLineInTx(tx, actor, po, p);
    return { po, lines: parsed.length };
  });
}

/** Open POs due by today or earlier that still have something to come: for the dashboard and Tally. */
export async function overduePurchaseOrders(actor: Pick<Actor, "orgId" | "facilityId">) {
  const today = await facilityToday(actor.facilityId);
  return (
    await db.execute<{ id: string; number: string; vendor: string; expected_on: string }>(sql`
      select po.id, po.number, c.name as vendor, po.expected_on from purchase_orders po join customers c on c.id = po.vendor_id
      where po.org_id = ${actor.orgId} and po.facility_id = ${actor.facilityId} and po.status in ('SENT', 'PARTIAL')
        and po.expected_on is not null and po.expected_on < ${today}
      order by po.expected_on limit 20`)
  ).rows;
}
