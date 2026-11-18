import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, itemCategories, items, locations, packages } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { atomically, db, dryRun } from "@/lib/db";
import { generateSku, normalizeSku } from "@/lib/ids";
import { addLabResult, receivePackage, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { FIELD_LABEL, planDutchie, type DutchieField, type Plan } from "./dutchie-parse";

/**
 * Switch from Dutchie: load a Dutchie POS inventory report into this facility. Products, rooms, and
 * packages (with their tags, batches, quantities, and costs) come across; THC and CBD numbers become
 * pending lab results. Checked in full first; then everything saves together or nothing does.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

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
export async function readReport(name: string, bytes: Buffer): Promise<string[][]> {
  if (bytes.length > MAX_FILE_BYTES) throw new InventoryError("The file is larger than 5 MB. Export fewer columns or one location at a time.");
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
};

async function apply(actor: Actor, plan: Plan): Promise<DutchieResult> {
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
  const existing = await db.select().from(items).where(eq(items.orgId, actor.orgId));
  const itemId = new Map<string, string>();
  const keyOf = (r: (typeof plan.rows)[number]) => `${(r.sku ?? "").toUpperCase()}|${r.product.toLowerCase()}|${r.unit}`;
  for (const r of plan.rows) {
    const key = keyOf(r);
    if (itemId.has(key)) continue;
    const bySku = r.sku ? existing.find((i) => i.sku === r.sku!.toUpperCase()) : undefined;
    const byName = existing.find((i) => i.name.toLowerCase() === r.product.toLowerCase() && i.unit === r.unit);
    const found = bySku && bySku.unit === r.unit ? bySku : byName;
    if (found) {
      itemId.set(key, found.id);
      result.products.reused++;
      continue;
    }
    let sku: string | null = null;
    if (r.sku) {
      try {
        const candidate = normalizeSku(r.sku);
        if (!existing.some((i) => i.sku === candidate)) sku = candidate;
      } catch {
        // Not a usable SKU (spaces, symbols); a new one is generated.
      }
    }
    sku ??= await generateSku(db, actor.orgId, r.category);
    const [made] = await db
      .insert(items)
      .values({ orgId: actor.orgId, name: r.product, sku, categoryId: categoryId(r.category), unit: r.unit, strain: r.strain, unitWeightGrams: r.unitWeightGrams })
      .returning();
    existing.push(made);
    itemId.set(key, made.id);
    result.products.created++;
  }

  // Packages, one per row. A row that fails is listed; any failure means nothing is kept.
  const seenTags = new Set<string>();
  for (const r of plan.rows) {
    const label = `Line ${r.line} (${r.product}${r.tag ? `, ${r.tag}` : ""})`;
    if (r.tag) {
      const t = r.tag.toUpperCase();
      if (seenTags.has(t)) {
        problems.push(`${label}: the same package ID appears twice in the report.`);
        continue;
      }
      seenTags.add(t);
    }
    try {
      await db.transaction(async () => {
        const pkg = await receivePackage(actor, {
          tag: r.tag,
          itemId: itemId.get(keyOf(r))!,
          quantity: r.quantity,
          locationId: roomId.get(r.room.toLowerCase())!,
          lotNumber: r.lot,
          costPerUnit: r.cost && Number(r.cost) > 0 ? r.cost : null,
          note: "Imported from Dutchie",
        });
        result.packages++;
        if (result.sample.length < 8) result.sample.push({ tag: pkg.tag, product: r.product, quantity: `${r.quantity} ${r.unit === "EACH" ? "ea" : r.unit.toLowerCase()}`, room: r.room });
        if (r.thc || r.cbd) {
          await addLabResult(actor, {
            packageId: pkg.id,
            labName: "Imported from Dutchie",
            status: "PENDING",
            thcPercent: r.thc,
            cbdPercent: r.cbd,
            notes: "Potency copied from Dutchie. Check it against the certificate of analysis, then record a passed result.",
          });
          result.labResults++;
        }
      });
    } catch (error) {
      if (!(error instanceof InventoryError)) throw error;
      problems.push(`${label}: ${error.message.replace(/\.$/, "")}.`);
    }
    if (problems.length >= 50) {
      problems.push("Stopped after 50 problems.");
      break;
    }
  }
  if (!problems.length) {
    await db.insert(auditLogs).values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      userId: actor.userId,
      userName: actor.userName,
      entityType: "Import",
      entityId: "dutchie",
      action: "IMPORT",
      after: { source: "Dutchie", packages: result.packages, productsCreated: result.products.created, roomsCreated: result.rooms.created, labResults: result.labResults },
    });
  }
  return result;
}

/** Check a Dutchie report against this facility without saving anything. */
export async function previewDutchie(actor: Actor, table: string[][]): Promise<DutchieResult> {
  return dryRun(() => apply(actor, planDutchie(table)));
}

/** Load a Dutchie report. All or nothing: if any row has a problem, nothing is saved. */
export async function importDutchie(actor: Actor, table: string[][]): Promise<DutchieResult> {
  return atomically(async () => {
    const result = await apply(actor, planDutchie(table));
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
