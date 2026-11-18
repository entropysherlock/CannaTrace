import { gunzipSync } from "node:zlib";
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, inventoryTransactions, itemCategories, items, labResults, locations, packages } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { atomically, db, dryRun } from "@/lib/db";
import { generateSku, generateTags, normalizeSku } from "@/lib/ids";
import type { Actor } from "@/lib/inventory";
import { InventoryError, normalizeTag, parsePositiveQty } from "@/lib/inventory-math";
import { FIELD_LABEL, planImport, SOURCE_NAME, type DutchieField, type Plan, type Source } from "./dutchie-parse";

/**
 * Switch from Dutchie or Flourish: load an inventory export into this facility. Products, rooms, and
 * packages (with their tags, batches, quantities, and costs) come across; THC and CBD numbers become
 * pending lab results. Checked in full first; then everything saves together or nothing does.
 */

/** The largest export, once unzipped. Big files are gzipped in the browser before upload (see dutchie-import.tsx). */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
/** Rows saved per database statement, well under Postgres's 65,535 parameters. */
const CHUNK = 1000;
const chunks = <T,>(list: T[], size = CHUNK) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in value) return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
  }
  return "";
}

/** The first sheet of an Excel file, or a CSV file, as rows of text. */
export async function readReport(name: string, raw: Buffer): Promise<string[][]> {
  // The browser gzips large files so they fit through the upload limit; unzip them here.
  let bytes = raw;
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      bytes = gunzipSync(raw, { maxOutputLength: MAX_FILE_BYTES + 1 });
    } catch {
      throw new InventoryError("The file is larger than 40 MB once unzipped. Export one location at a time.");
    }
    name = name.replace(/\.gz$/i, "");
  }
  if (bytes.length > MAX_FILE_BYTES) throw new InventoryError("The file is larger than 40 MB. Export one location at a time.");
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(name)) {
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(bytes as unknown as ArrayBuffer);
    } catch {
      throw new InventoryError("That Excel file couldn't be read. Save it again as .xlsx or .csv and try once more.");
    }
    const sheet = book.worksheets.find((w) => w.state === "visible") ?? book.worksheets[0];
    if (!sheet) throw new InventoryError("The Excel file has no sheets.");
    const table: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      table.push((row.values as ExcelJS.CellValue[]).slice(1).map(cellText));
    });
    return table;
  }
  if (/\.xls$/i.test(name)) throw new InventoryError("Old .xls files aren't supported. In Excel, save it as .xlsx or .csv first.");
  return parseCsv(bytes.toString("utf8"));
}

export type DutchieResult = {
  matched: { field: string; column: string }[];
  warnings: string[];
  problems: string[];
  products: { created: number; reused: number };
  rooms: { created: number; reused: number };
  packages: number;
  labResults: number;
  sample: { tag: string; product: string; quantity: string; room: string }[];
  /** The stores the file names, when there's more than one: pick one and check again. */
  stores: { name: string; rows: number }[];
};

async function apply(actor: Actor, plan: Plan, source: Source): Promise<DutchieResult> {
  const from = `Imported from ${SOURCE_NAME[source]}`;
  const problems = [...plan.problems];
  const result: DutchieResult = {
    matched: (Object.entries(plan.matched) as [DutchieField, string][]).map(([f, column]) => ({ field: FIELD_LABEL[f], column })),
    warnings: plan.warnings,
    problems,
    products: { created: 0, reused: 0 },
    rooms: { created: 0, reused: 0 },
    packages: 0,
    labResults: 0,
    sample: [],
    stores: plan.stores,
  };
  if (problems.length) return result;

  // Categories (shared across the business)
  const categoryNames = [...new Set(plan.rows.map((r) => r.category))];
  await db
    .insert(itemCategories)
    .values(categoryNames.map((name) => ({ orgId: actor.orgId, name })))
    .onConflictDoNothing();
  const categoryRows = await db.select().from(itemCategories).where(eq(itemCategories.orgId, actor.orgId));
  const categoryId = (name: string) => categoryRows.find((c) => c.name === name)!.id;

  // Rooms at this facility, matched by name without regard to case
  const roomId = new Map<string, string>();
  for (const loc of await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.orgId, actor.orgId), eq(locations.facilityId, actor.facilityId)))) {
    roomId.set(loc.name.toLowerCase(), loc.id);
  }
  for (const name of [...new Set(plan.rows.map((r) => r.room))]) {
    if (roomId.has(name.toLowerCase())) {
      result.rooms.reused++;
      continue;
    }
    const [made] = await db
      .insert(locations)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name, type: "ROOM", area: "INVENTORY" })
      .returning({ id: locations.id });
    roomId.set(name.toLowerCase(), made.id);
    result.rooms.created++;
  }

  // Products: an existing item with the same SKU, or the same name and unit, is reused; otherwise one is made.
  // A name only matches products that were here before this import: in one file, rows with different
  // SKUs are different products (the same strain from two brands), even when their names match.
  const before = await db.select().from(items).where(eq(items.orgId, actor.orgId));
  const skus = new Set(before.map((i) => i.sku));
  const itemId = new Map<string, string>();
  const keyOf = (r: (typeof plan.rows)[number]) => `${(r.sku ?? "").toUpperCase()}|${r.product.toLowerCase()}|${r.unit}`;
  const toMake: { key: string; values: typeof items.$inferInsert }[] = [];
  const planned = new Set<string>();
  for (const r of plan.rows) {
    const key = keyOf(r);
    if (itemId.has(key) || planned.has(key)) continue;
    const bySku = r.sku ? before.find((i) => i.sku === r.sku!.toUpperCase()) : undefined;
    const byName = before.find((i) => i.name.toLowerCase() === r.product.toLowerCase() && i.unit === r.unit);
    const found = bySku && bySku.unit === r.unit ? bySku : byName && (!r.sku || !bySku) ? byName : undefined;
    if (found) {
      itemId.set(key, found.id);
      result.products.reused++;
      continue;
    }
    let sku: string | null = null;
    if (r.sku) {
      try {
        const candidate = normalizeSku(r.sku);
        if (!skus.has(candidate)) sku = candidate;
      } catch {
        // Not a usable SKU (spaces, symbols); a new one is generated.
      }
    }
    sku ??= await generateSku(db, actor.orgId, r.category);
    skus.add(sku);
    planned.add(key);
    toMake.push({ key, values: { orgId: actor.orgId, name: r.product, sku, categoryId: categoryId(r.category), unit: r.unit, strain: r.strain, unitWeightGrams: r.unitWeightGrams } });
  }
  for (const part of chunks(toMake)) {
    const made = await db.insert(items).values(part.map((m) => m.values)).returning({ id: items.id, sku: items.sku });
    const bySku = new Map(made.map((m) => [m.sku, m.id]));
    for (const m of part) itemId.set(m.key, bySku.get(m.values.sku!)!);
    result.products.created += made.length;
  }

  // Packages. Every row is checked before anything is written, then all are saved in large batches,
  // so a 25,000-row store fits well inside the time a request may run. Any problem means nothing is kept.
  type Ready = { r: (typeof plan.rows)[number]; label: string; tag: string; quantity: Decimal; cost: Decimal | null };
  const ready: Ready[] = [];
  const seenTags = new Set<string>();
  for (const r of plan.rows) {
    if (problems.length >= 50) {
      problems.push("Stopped after 50 problems.");
      break;
    }
    const label = `Line ${r.line} (${r.product}${r.tag ? `, ${r.tag}` : ""})`;
    try {
      const tag = r.tag ? normalizeTag(r.tag) : "";
      if (tag && seenTags.has(tag)) {
        problems.push(`${label}: the same package ID appears twice in the file.`);
        continue;
      }
      if (tag) seenTags.add(tag);
      const quantity = parsePositiveQty(r.quantity);
      const cost = r.cost && Number(r.cost) > 0 ? parsePositiveQty(r.cost, "Cost per unit") : null;
      ready.push({ r, label, tag, quantity, cost });
    } catch (error) {
      if (!(error instanceof InventoryError)) throw error;
      problems.push(`${label}: ${error.message.replace(/\.$/, "")}.`);
    }
  }

  // Package IDs that are already in CannaTrace
  const taken = new Set<string>();
  for (const part of chunks([...seenTags])) {
    for (const row of await db.select({ tag: packages.tag }).from(packages).where(and(eq(packages.orgId, actor.orgId), inArray(packages.tag, part)))) taken.add(row.tag);
  }
  if (taken.size) {
    if (taken.size === seenTags.size) problems.unshift(`This file was already imported: all ${seenTags.size.toLocaleString("en-US")} of its package IDs are already in CannaTrace.`);
    else {
      const clashes = ready.filter((x) => taken.has(x.tag));
      problems.push(
        `${clashes.length.toLocaleString("en-US")} package ID${clashes.length === 1 ? " is" : "s are"} already in CannaTrace. Every package needs its own ID:`,
        ...clashes.slice(0, 20).map((x) => `${x.label}: tag ${x.tag} is already in use.`),
      );
    }
  }
  if (problems.length) return result;

  // New CannaTrace IDs for rows without one
  const blanks = ready.filter((x) => !x.tag);
  const fresh: string[] = [];
  for (const part of chunks(blanks, 2000)) fresh.push(...(await generateTags(db, actor.orgId, "PACKAGE", part.length)));
  blanks.forEach((x, k) => (x.tag = fresh[k]));

  for (const part of chunks(ready)) {
    const made = await db
      .insert(packages)
      .values(
        part.map((x) => ({
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          tag: x.tag,
          itemId: itemId.get(keyOf(x.r))!,
          quantity: x.quantity.toFixed(4),
          unit: x.r.unit,
          locationId: roomId.get(x.r.room.toLowerCase())!,
          lotNumber: x.r.lot?.trim().slice(0, 80) || null,
          costPerUnit: x.cost ? x.cost.toFixed(4) : null,
          status: x.r.status,
        })),
      )
      .returning();
    const byTag = new Map(made.map((p) => [p.tag, p]));
    const rows = part.map((x) => ({ ...x, pkg: byTag.get(x.tag)! }));
    await db.insert(inventoryTransactions).values(
      rows.map(({ pkg }) => ({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        packageId: pkg.id,
        type: "RECEIVE" as const,
        quantityDelta: pkg.quantity,
        quantityBefore: "0",
        quantityAfter: pkg.quantity,
        unit: pkg.unit,
        toLocationId: pkg.locationId,
        note: from,
        userId: actor.userId,
      })),
    );
    const who = { orgId: actor.orgId, facilityId: actor.facilityId, userId: actor.userId, userName: actor.userName };
    await db.insert(auditLogs).values(
      rows.map(({ pkg }) => ({
        ...who,
        entityType: "Package",
        entityId: pkg.id,
        action: "RECEIVE",
        after: { tag: pkg.tag, quantity: new Decimal(pkg.quantity).toString(), unit: pkg.unit, status: pkg.status, locationId: pkg.locationId },
        reason: from,
      })),
    );
    // Potency from the old system comes in as pending, to be confirmed against the certificate.
    // A package the old system says failed comes in quarantined with its failed result.
    const tested = rows.filter(({ r }) => r.thc || r.cbd || r.labFailed);
    if (tested.length) {
      await db.insert(labResults).values(
        tested.map(({ r, pkg }) => ({
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          packageId: pkg.id,
          labName: from,
          status: r.labFailed ? ("FAIL" as const) : ("PENDING" as const),
          thcPercent: r.thc,
          cbdPercent: r.cbd,
          notes: r.labFailed
            ? `${SOURCE_NAME[source]} recorded a failed lab test. The package came in quarantined.`
            : `Potency copied from ${SOURCE_NAME[source]}. Check it against the certificate of analysis, then record a passed result.`,
          userId: actor.userId,
        })),
      );
      await db.insert(auditLogs).values(
        tested.map(({ r, pkg }) => ({
          ...who,
          entityType: "Package",
          entityId: pkg.id,
          action: "LAB_RESULT",
          after: { labName: from, status: r.labFailed ? "FAIL" : "PENDING", thcPercent: r.thc, cbdPercent: r.cbd },
        })),
      );
      result.labResults += tested.length;
    }
    result.packages += rows.length;
    for (const { r, pkg } of rows) {
      if (result.sample.length >= 8) break;
      result.sample.push({ tag: pkg.tag, product: r.product, quantity: `${r.quantity} ${r.unit === "EACH" ? "ea" : r.unit.toLowerCase()}`, room: r.room });
    }
  }
  if (!problems.length) {
    await db.insert(auditLogs).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      userId: actor.userId,
      userName: actor.userName,
      entityType: "Import",
      entityId: source,
      action: "IMPORT",
      after: { source: SOURCE_NAME[source], packages: result.packages, productsCreated: result.products.created, roomsCreated: result.rooms.created, labResults: result.labResults },
    });
  }
  return result;
}

/** Check an export against this facility without saving anything. */
export async function previewImport(source: Source, actor: Actor, table: string[][], store?: string): Promise<DutchieResult> {
  return dryRun(() => apply(actor, planImport(source, table, { store }), source));
}

/** Load an export. All or nothing: if any row has a problem, nothing is saved. */
export async function importInventory(source: Source, actor: Actor, table: string[][], store?: string): Promise<DutchieResult> {
  return atomically(async () => {
    const result = await apply(actor, planImport(source, table, { store }), source);
    if (result.problems.length) {
      throw new InventoryError(`Nothing was imported. Fix these and try again:\n${result.problems.slice(0, 20).join("\n")}`);
    }
    return result;
  });
}

/** Packages already at this facility, for the "you already have inventory" note. */
export async function packageCount(actor: Actor): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId)));
  return n;
}

export const previewDutchie = (actor: Actor, table: string[][]) => previewImport("dutchie", actor, table);
export const importDutchie = (actor: Actor, table: string[][]) => importInventory("dutchie", actor, table);
