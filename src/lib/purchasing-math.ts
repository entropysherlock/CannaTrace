import Decimal from "decimal.js";

/**
 * The rules for purchase orders that need no database: what status a PO is in after receiving,
 * what is still to come, and how an imported spreadsheet row is read. Tested on their own.
 */

export type PoStatus = "DRAFT" | "SENT" | "PARTIAL" | "RECEIVED" | "CANCELLED";

/** Still to come on a line: ordered less received, never below zero. */
export function remaining(line: { quantity: Decimal.Value; quantityReceived: Decimal.Value }): Decimal {
  return Decimal.max(new Decimal(line.quantity).sub(line.quantityReceived), 0);
}

/** After receiving: RECEIVED when every line is in full, PARTIAL when something has come in, else unchanged. */
export function statusAfterReceiving(lines: { quantity: Decimal.Value; quantityReceived: Decimal.Value }[], current: PoStatus): PoStatus {
  if (!lines.length) return current;
  if (lines.every((l) => remaining(l).isZero())) return "RECEIVED";
  if (lines.some((l) => new Decimal(l.quantityReceived).gt(0))) return "PARTIAL";
  return current;
}

/** Total cost of a PO as ordered. Lines without a cost count as zero. */
export function poTotal(lines: { quantity: Decimal.Value; unitCost: Decimal.Value | null }[]): Decimal {
  return lines.reduce((sum, l) => sum.add(new Decimal(l.quantity).mul(l.unitCost ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), new Decimal(0));
}

/** Lines can change, and the PO can be cancelled, only before anything has been received. */
export const editable = (status: PoStatus) => status === "DRAFT" || status === "SENT";
export const receivable = (status: PoStatus) => status === "SENT" || status === "PARTIAL" || status === "DRAFT";

export type CatalogItem = { id: string; name: string; sku: string };

/**
 * Match a spreadsheet row's product to a catalog item: SKU first, then the exact name, ignoring case
 * and extra spaces. Returns null when nothing matches or several names do.
 */
export function matchItem(row: { sku?: string; item?: string }, catalog: CatalogItem[]): CatalogItem | null {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  const sku = norm(row.sku ?? "");
  if (sku) {
    const bySku = catalog.find((c) => norm(c.sku) === sku);
    if (bySku) return bySku;
  }
  const name = norm(row.item ?? "");
  if (!name) return null;
  const byName = catalog.filter((c) => norm(c.name) === name);
  return byName.length === 1 ? byName[0] : null;
}
