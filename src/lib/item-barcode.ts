import { and, eq, ne, sql } from "drizzle-orm";
import { items } from "@/db/schema";
import { type db, type Tx } from "./db";
import { barcodeKey, cleanBarcode } from "./barcode";
import { InventoryError } from "./inventory-math";

type Q = Tx | typeof db;

const fail = (message: string): never => {
  throw new InventoryError(message);
};

/**
 * Check a typed or scanned barcode and make sure no other item already has it (ignoring leading zeros).
 * Returns the cleaned barcode, or null when it was left blank.
 */
export async function checkBarcode(q: Q, orgId: string, raw: unknown, exceptItemId?: string): Promise<string | null> {
  const barcode = cleanBarcode(raw, fail);
  if (!barcode) return null;
  const rows = await q
    .select({ name: items.name })
    .from(items)
    .where(and(eq(items.orgId, orgId), sql`ltrim(upper(${items.barcode}), '0') = ${barcodeKey(barcode)}`, exceptItemId ? ne(items.id, exceptItemId) : undefined));
  if (rows[0]) fail(`That barcode already belongs to ${rows[0].name}. Each product can have only one item.`);
  return barcode;
}

/** The item a scanned barcode belongs to at this business, or null. Matches with or without leading zeros. */
export async function itemIdByBarcode(q: Q, orgId: string, code: string): Promise<string | null> {
  const key = barcodeKey(code);
  if (!key) return null;
  const [row] = await q
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.orgId, orgId), eq(items.active, true), sql`ltrim(upper(${items.barcode}), '0') = ${key}`));
  return row?.id ?? null;
}
