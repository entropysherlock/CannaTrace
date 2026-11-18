import Decimal from "decimal.js";
import type { UnitCode } from "@/lib/units";

/**
 * Reading a Dutchie POS inventory export (Backoffice → Reports → Current Inventory, exported to Excel or CSV).
 * Column names are matched loosely, because Dutchie lets each store choose and reorder its report columns.
 * Pure functions: no database. The importer in ./dutchie.ts turns the plan into records.
 */

export type DutchieField =
  | "product"
  | "sku"
  | "category"
  | "strain"
  | "brand"
  | "tag"
  | "externalTag"
  | "batch"
  | "room"
  | "store"
  | "quantity"
  | "grams"
  | "unit"
  | "cost"
  | "vendor"
  | "thc"
  | "cbd";

/** What each field is called in Dutchie reports (and close variants), lower-case without punctuation. */
const ALIASES: Record<DutchieField, string[]> = {
  product: ["product name", "product", "item name", "item"],
  sku: ["sku", "product sku", "provincial sku", "upc gtin", "upc", "gtin"],
  category: ["category", "product category", "master category"],
  strain: ["strain name", "strain"],
  brand: ["brand", "brand name"],
  tag: ["package id", "package number", "package", "package label"],
  externalTag: ["external package id", "metrc tag", "metrc package", "state tag", "biotrack id", "nms2s id"],
  batch: ["batch number", "batch name", "batch id", "batch", "lot number", "lot"],
  room: ["inventory location", "room", "room name", "location in store"],
  store: ["location name", "store", "store name"],
  quantity: ["quantity", "available", "available quantity", "quantity on hand", "on hand", "qty"],
  grams: ["grams", "total grams", "net weight", "weight"],
  unit: ["unit", "unit of measure", "uom", "units"],
  cost: ["cost", "unit cost", "cost per unit"],
  vendor: ["vendor", "vendor name", "supplier"],
  thc: ["thc", "thc %", "thc percent", "total thc", "total thc %"],
  cbd: ["cbd", "cbd %", "cbd percent", "total cbd", "total cbd %"],
};

export const FIELD_LABEL: Record<DutchieField, string> = {
  product: "Product name",
  sku: "SKU",
  category: "Category",
  strain: "Strain",
  brand: "Brand",
  tag: "Package ID",
  externalTag: "External (state) package ID",
  batch: "Batch / lot",
  room: "Room",
  store: "Store location",
  quantity: "Quantity",
  grams: "Grams",
  unit: "Unit",
  cost: "Cost",
  vendor: "Vendor",
  thc: "THC %",
  cbd: "CBD %",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/%/g, " % ")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Which column holds each field. Exact alias matches win over partial ones; each column is used once. */
export function matchColumns(header: string[]): Partial<Record<DutchieField, number>> {
  const cols = header.map(norm);
  const used = new Set<number>();
  const out: Partial<Record<DutchieField, number>> = {};
  for (const field of Object.keys(ALIASES) as DutchieField[]) {
    for (const alias of ALIASES[field]) {
      const at = cols.findIndex((c, i) => !used.has(i) && c === alias);
      if (at >= 0) {
        out[field] = at;
        used.add(at);
        break;
      }
    }
  }
  return out;
}

/** Reports often start with a title or date line; the header is the first row naming at least three fields. */
export function findHeader(table: string[][]): number {
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    if (Object.keys(matchColumns(table[i])).length >= 3) return i;
  }
  return -1;
}

const UNIT_WORDS: Record<string, UnitCode> = {
  g: "G",
  gram: "G",
  grams: "G",
  gr: "G",
  mg: "MG",
  milligram: "MG",
  milligrams: "MG",
  kg: "KG",
  oz: "OZ",
  ounce: "OZ",
  ounces: "OZ",
  lb: "LB",
  lbs: "LB",
  pound: "LB",
  ml: "ML",
  l: "L",
  ea: "EACH",
  each: "EACH",
  unit: "EACH",
  units: "EACH",
  qty: "EACH",
  pc: "EACH",
  pcs: "EACH",
};

/** A number from a report cell: "1,234.5", "$12.00", "21.4%" all work. Blank or text gives null. */
export function num(raw: string | undefined): Decimal | null {
  const text = (raw ?? "").replace(/[$,%\s]/g, "");
  if (!text) return null;
  try {
    const d = new Decimal(text);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export type PlanRow = {
  line: number;
  product: string;
  sku: string | null;
  category: string;
  strain: string | null;
  /** The state tag when the report has one, otherwise Dutchie's package ID, otherwise blank (generated on import). */
  tag: string;
  lot: string | null;
  room: string;
  quantity: string;
  unit: UnitCode;
  /** Grams in one unit, for products counted each. */
  unitWeightGrams: string | null;
  cost: string | null;
  thc: string | null;
  cbd: string | null;
};

export type Plan = {
  matched: Partial<Record<DutchieField, string>>;
  rows: PlanRow[];
  problems: string[];
  warnings: string[];
};

/**
 * How a row is counted. A Unit column wins. Otherwise Dutchie's Grams column (total grams in the package)
 * tells bulk weight from counted units: grams equal to quantity means it's tracked by the gram; otherwise
 * each unit weighs grams ÷ quantity. With neither, the product is counted each.
 */
export function unitFor(unitCell: string | undefined, quantity: Decimal, grams: Decimal | null): { unit: UnitCode; unitWeightGrams: string | null } {
  const word = norm(unitCell ?? "");
  if (word && UNIT_WORDS[word]) return { unit: UNIT_WORDS[word], unitWeightGrams: null };
  if (grams && grams.gt(0)) {
    if (grams.sub(quantity).abs().lte(0.001)) return { unit: "G", unitWeightGrams: null };
    if (quantity.gt(0)) return { unit: "EACH", unitWeightGrams: grams.div(quantity).toDecimalPlaces(4).toString() };
  }
  return { unit: "EACH", unitWeightGrams: null };
}

export const IMPORT_ROOM = "Imported from Dutchie";
export const MAX_DUTCHIE_ROWS = 5000;

export function planDutchie(table: string[][]): Plan {
  const problems: string[] = [];
  const warnings: string[] = [];
  const at = findHeader(table);
  if (at < 0) {
    return {
      matched: {},
      rows: [],
      problems: ["This doesn't look like a Dutchie inventory report: no row names columns like Product Name, Package ID, and Quantity."],
      warnings,
    };
  }
  const header = table[at];
  const cols = matchColumns(header);
  const matched = Object.fromEntries(Object.entries(cols).map(([f, i]) => [f, header[i as number]])) as Plan["matched"];
  if (cols.product === undefined) problems.push("The report has no Product Name column.");
  if (cols.quantity === undefined) problems.push("The report has no Quantity column.");
  if (problems.length) return { matched, rows: [], problems, warnings };

  const body = table.slice(at + 1);
  if (body.length > MAX_DUTCHIE_ROWS) problems.push(`The report has ${body.length.toLocaleString("en-US")} rows; import at most ${MAX_DUTCHIE_ROWS.toLocaleString("en-US")} at a time.`);
  const get = (cells: string[], f: DutchieField) => (cols[f] === undefined ? "" : (cells[cols[f] as number] ?? "").trim());

  const rows: PlanRow[] = [];
  const stores = new Set<string>();
  let skippedEmpty = 0;
  let pendingLab = 0;
  body.slice(0, MAX_DUTCHIE_ROWS).forEach((cells, i) => {
    const line = at + i + 2;
    const product = get(cells, "product");
    if (!product) {
      // Totals and blank lines at the bottom of a report.
      if (cells.some((c) => c.trim())) warnings.push(`Line ${line} has no product name and was skipped.`);
      return;
    }
    const quantity = num(get(cells, "quantity"));
    if (!quantity) return void problems.push(`Line ${line} (${product}): Quantity is not a number.`);
    if (quantity.lte(0)) return void skippedEmpty++;
    const store = get(cells, "store");
    if (store) stores.add(store);
    const { unit, unitWeightGrams } = unitFor(get(cells, "unit"), quantity, num(get(cells, "grams")));
    const thc = num(get(cells, "thc"));
    const cbd = num(get(cells, "cbd"));
    if (thc || cbd) pendingLab++;
    rows.push({
      line,
      product: product.slice(0, 120),
      sku: get(cells, "sku") || null,
      category: get(cells, "category").slice(0, 60) || "Imported",
      strain: get(cells, "strain") || null,
      tag: (get(cells, "externalTag") || get(cells, "tag")).replace(/\s+/g, ""),
      lot: get(cells, "batch") || null,
      room: get(cells, "room").slice(0, 80) || IMPORT_ROOM,
      quantity: quantity.toString(),
      unit,
      unitWeightGrams,
      cost: num(get(cells, "cost"))?.toString() ?? null,
      thc: thc && thc.gte(0) && thc.lte(100) ? thc.toString() : null,
      cbd: cbd && cbd.gte(0) && cbd.lte(100) ? cbd.toString() : null,
    });
  });
  if (skippedEmpty) warnings.push(`${skippedEmpty} package${skippedEmpty === 1 ? " has" : "s have"} nothing left (quantity 0) and won't be imported.`);
  if (stores.size > 1) warnings.push(`The report covers ${stores.size} store locations (${[...stores].slice(0, 3).join(", ")}${stores.size > 3 ? ", …" : ""}). Every row goes into the facility you're in now; export one location at a time to keep them apart.`);
  if (cols.room === undefined) warnings.push(`There's no room column, so everything goes into a new room called "${IMPORT_ROOM}". You can move packages afterwards.`);
  if (cols.tag === undefined && cols.externalTag === undefined) warnings.push("There's no package ID column, so every package gets a new CannaTrace ID (PKG-…).");
  if (pendingLab) warnings.push(`${pendingLab} package${pendingLab === 1 ? " has" : "s have"} THC or CBD numbers. They're saved as pending lab results: confirm each with its certificate before it can go on a retail label.`);
  return { matched, rows, problems, warnings };
}
