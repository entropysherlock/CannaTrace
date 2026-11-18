import { and, eq, inArray, sql } from "drizzle-orm";
import { idCounters, items, packages, plants } from "@/db/schema";
import { type db, type Tx } from "./db";

type Q = Tx | typeof db;
import { InventoryError, normalizeTag } from "./inventory-math";

/**
 * Generated IDs. Plant tags read PLT-000001, package tags PKG-000001, and SKUs take the first letters
 * of the item's category, as in FLO-0001. Each business counts up on its own, the counter is locked
 * while numbers are handed out, and any ID already in use (typed in by hand earlier, or imported)
 * is skipped, so a generated ID is always unique in the business.
 * A state tag can still be scanned or typed instead wherever a tag is asked for.
 */

export const TAG_PREFIX = { PLANT: "PLT", PACKAGE: "PKG" } as const;
export type TagKind = keyof typeof TAG_PREFIX;

const MAX_ROUNDS = 20;

/** Reserve `count` consecutive numbers for this business and kind. */
async function reserve(tx: Q, orgId: string, kind: string, count: number): Promise<number> {
  const rows = await tx
    .insert(idCounters)
    .values({ orgId, kind, nextValue: count + 1 })
    .onConflictDoUpdate({ target: [idCounters.orgId, idCounters.kind], set: { nextValue: sql`${idCounters.nextValue} + ${count}` } })
    .returning({ next: idCounters.nextValue });
  return rows[0].next - count;
}

async function takeUnused(tx: Q, orgId: string, kind: string, count: number, format: (n: number) => string, taken: (candidates: string[]) => Promise<Set<string>>) {
  const out: string[] = [];
  for (let round = 0; round < MAX_ROUNDS && out.length < count; round++) {
    const need = count - out.length;
    const first = await reserve(tx, orgId, kind, need);
    const candidates = Array.from({ length: need }, (_, i) => format(first + i));
    const used = await taken(candidates);
    out.push(...candidates.filter((c) => !used.has(c)));
  }
  if (out.length < count) throw new InventoryError("Couldn't generate enough unused IDs. Try again, or enter them by hand.");
  return out;
}

/** New, unused tags for plants or packages in this business. */
export async function generateTags(tx: Q, orgId: string, kind: TagKind, count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 2000) throw new InventoryError("Generate between 1 and 2,000 tags at a time.");
  const table = kind === "PLANT" ? plants : packages;
  return takeUnused(
    tx,
    orgId,
    `TAG:${kind}`,
    count,
    (n) => `${TAG_PREFIX[kind]}-${String(n).padStart(6, "0")}`,
    async (candidates) => new Set((await tx.select({ tag: table.tag }).from(table).where(and(eq(table.orgId, orgId), inArray(table.tag, candidates)))).map((r) => r.tag)),
  );
}

/** The tag typed or scanned, or a newly generated one when the box was left blank. */
export async function tagOrGenerate(tx: Q, orgId: string, kind: TagKind, raw: unknown): Promise<string> {
  return String(raw ?? "").trim() ? normalizeTag(raw) : (await generateTags(tx, orgId, kind, 1))[0];
}

/** "Pre-rolls" → "PRE", "Edibles" → "EDI"; categories without enough letters use "ITM". */
export function skuPrefix(category: string): string {
  const letters = category.toUpperCase().replace(/[^A-Z]/g, "");
  return letters.length >= 2 ? letters.slice(0, 3) : "ITM";
}

/** A new, unused SKU for an item in this category. */
export async function generateSku(tx: Q, orgId: string, category: string): Promise<string> {
  const prefix = skuPrefix(category);
  const [sku] = await takeUnused(
    tx,
    orgId,
    `SKU:${prefix}`,
    1,
    (n) => `${prefix}-${String(n).padStart(4, "0")}`,
    async (candidates) => new Set((await tx.select({ sku: items.sku }).from(items).where(and(eq(items.orgId, orgId), inArray(items.sku, candidates)))).map((r) => r.sku)),
  );
  return sku;
}

/** SKUs are kept upper-case, 2 to 40 letters, digits, dashes, dots, or underscores. */
export function normalizeSku(raw: unknown): string {
  const sku = String(raw ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(sku)) throw new InventoryError(`"${sku.slice(0, 40)}" isn't a valid SKU. Use 2 to 40 letters, digits, dashes, dots, or underscores.`);
  return sku;
}
