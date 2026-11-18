import Decimal from "decimal.js";
import type { UnitCode } from "@/lib/units";

/**
 * Reading an inventory export from another system so a business can switch to CannaTrace:
 * - Dutchie POS: Backoffice → Reports → Current Inventory, exported to Excel or CSV.
 * - Flourish: Inventory → All Packages, exported to Excel.
 * - NMS2S (New Mexico's state system): the Inventory table of an inventory room, with the columns its
 *   Manage Columns panel names (ID, Product Type, Product Name, Strain Name, Unit/Package Count, …).
 * Column names are matched loosely, because both let each business choose and reorder columns.
 * Pure functions: no database. The importer in ./dutchie.ts turns the plan into records.
 */

export type Source = "dutchie" | "flourish" | "nms2s";
export const SOURCE_NAME: Record<Source, string> = { dutchie: "Dutchie", flourish: "Flourish", nms2s: "NMS2S" };
export const isSource = (s: unknown): s is Source => s === "dutchie" || s === "flourish" || s === "nms2s";

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
  | "unitWeight"
  | "cost"
  | "vendor"
  | "thc"
  | "cbd"
  | "destroy";

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
  unitWeight: ["unit weight", "unit weight g", "unit weight grams", "net weight per unit"],
  cost: ["cost", "unit cost", "cost per unit"],
  vendor: ["vendor", "vendor name", "supplier"],
  thc: ["thc", "thc %", "thc percent", "total thc", "total thc %"],
  cbd: ["cbd", "cbd %", "cbd percent", "total cbd", "total cbd %"],
  destroy: ["scheduled for destruction"],
};

/**
 * Flourish names: the item is "Item Name", the state tag sits in "Metrc Tag" (or the state system's name),
 * the batch is the "Lot", and packages live in "Areas". Its "Location" is a place in the building, not a store.
 */
const FLOURISH_ALIASES: Partial<Record<DutchieField, string[]>> = {
  product: ["item name", "item", "product name", "product"],
  tag: ["package id", "package", "package number"],
  externalTag: ["metrc tag", "metrc tag number", "tag number", "external id", "external package id", "state tag", "biotrack id", "nms2s id", "nms2s tag"],
  batch: ["lot", "lot number", "lot batch", "lot batch number", "batch", "batch number"],
  room: ["area", "area name", "location", "sub area", "sublocation"],
  store: ["facility", "facility name", "license"],
  quantity: ["quantity", "qty", "qty on hand", "quantity on hand", "available qty", "available quantity", "available", "on hand"],
  grams: ["total weight", "total grams", "grams"],
};

/**
 * NMS2S names, from the state's Inventory Rooms training manual (INV13, Manage Column Headers). Its "ID" is
 * the 16-digit state inventory ID. Bulk rows have their weight, with its unit, in "Total Cannabis …" and no
 * count; packaged rows have a Unit/Package Count and an Amount Per Unit/Package. Product Name may be blank.
 */
const NMS2S_ALIASES: Partial<Record<DutchieField, string[]>> = {
  product: ["product name", "product"],
  tag: ["id", "inventory id", "inventory item id", "item id", "nms2s id"],
  // "Related Item ID" is the item a package was split from, not its own ID, so it is never read as the tag.
  externalTag: [],
  category: ["product type", "type"],
  strain: ["strain name", "strain"],
  batch: ["batch", "batch number", "batch id", "lot", "lot number", "harvest batch"],
  room: ["inventory room", "room", "room name"],
  quantity: ["unit package count", "unit count", "package count", "units"],
  grams: ["total cannabis weight", "total cannabis wt", "total cannabis amount", "total cannabis quantity", "total cannabis", "total weight", "weight", "quantity"],
  unitWeight: ["amount per unit package", "amount per unit", "amount per package"],
  thc: ["total thc", "total thc %", "thc", "thc %"],
  cbd: ["total cbd", "total cbd %", "cbd"],
};

const aliasesFor = (source: Source): Record<DutchieField, string[]> =>
  source === "flourish" ? { ...ALIASES, ...FLOURISH_ALIASES } : source === "nms2s" ? { ...ALIASES, ...NMS2S_ALIASES } : ALIASES;

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
  unitWeight: "Unit weight",
  cost: "Cost",
  vendor: "Vendor",
  thc: "THC %",
  cbd: "CBD %",
  destroy: "Scheduled for destruction",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/%/g, " % ")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Which column holds each field. Exact alias matches win over partial ones; each column is used once. */
export function matchColumns(header: string[], source: Source = "dutchie"): Partial<Record<DutchieField, number>> {
  const aliases = aliasesFor(source);
  const cols = header.map(norm);
  const used = new Set<number>();
  const out: Partial<Record<DutchieField, number>> = {};
  for (const field of Object.keys(aliases) as DutchieField[]) {
    for (const alias of aliases[field]) {
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
export function findHeader(table: string[][], source: Source = "dutchie"): number {
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    if (Object.keys(matchColumns(table[i], source)).length >= 3) return i;
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
  pounds: "LB",
  kilogram: "KG",
  kilograms: "KG",
  milliliter: "ML",
  milliliters: "ML",
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
 * The package size written in a product name: "Blue Dream 3.5g" → 3.5, "Pre-Roll 1 g" → 1, "Flower 1oz" → 28.35.
 * Milligrams are left alone, because "Gummies 100mg" names the THC dose, not the weight.
 */
export function sizeInName(name: string): Decimal | null {
  const m = name.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|oz|ounce)\b/);
  if (!m) return null;
  const n = new Decimal(m[1]);
  if (n.lte(0)) return null;
  return m[2].startsWith("o") ? n.times("28.349523125").toDecimalPlaces(2) : n;
}

const BULK_WORDS = /\b(bulk|shake|trim|smalls|popcorn|loose|by the gram)\b/i;

/**
 * How a row is counted. A Unit column wins. A product named with a size ("3.5g", "1g", "1oz") and not
 * called bulk is counted each at that weight, even when Dutchie's Grams equals the Quantity (36 one-gram
 * pre-rolls are 36 g). Otherwise the Grams column (total grams in the package) tells bulk from counted:
 * grams equal to quantity means it's tracked by the gram; otherwise each unit weighs grams ÷ quantity.
 * With none of these, the product is counted each.
 */
export function unitFor(
  unitCell: string | undefined,
  quantity: Decimal,
  grams: Decimal | null,
  productName = "",
  /** Grams in one unit, when the export says so (Flourish's Unit Weight for items counted each). */
  unitWeight: Decimal | null = null,
): { unit: UnitCode; unitWeightGrams: string | null } {
  const word = norm(unitCell ?? "");
  const named = word ? UNIT_WORDS[word] : undefined;
  if (named === "EACH") {
    const each = unitWeight && unitWeight.gt(0) ? unitWeight : BULK_WORDS.test(productName) ? null : sizeInName(productName);
    return { unit: "EACH", unitWeightGrams: each ? each.toString() : grams && grams.gt(0) && quantity.gt(0) ? grams.div(quantity).toDecimalPlaces(4).toString() : null };
  }
  if (named) return { unit: named, unitWeightGrams: null };
  if (unitWeight && unitWeight.gt(0)) return { unit: "EACH", unitWeightGrams: unitWeight.toString() };
  const size = BULK_WORDS.test(productName) ? null : sizeInName(productName);
  if (size) return { unit: "EACH", unitWeightGrams: size.toString() };
  if (grams && grams.gt(0)) {
    if (grams.sub(quantity).abs().lte(0.001)) return { unit: "G", unitWeightGrams: null };
    if (quantity.gt(0)) return { unit: "EACH", unitWeightGrams: grams.div(quantity).toDecimalPlaces(4).toString() };
  }
  return { unit: "EACH", unitWeightGrams: null };
}

const GRAMS_PER: Partial<Record<UnitCode, string>> = { G: "1", KG: "1000", OZ: "28.349523125", LB: "453.59237", MG: "0.001" };

/** An amount with its unit in the same cell, as NMS2S shows weights: "500.00 g" → 500 G, "1.2 kg" → 1.2 KG, "20" → 20 with no unit. */
export function amountWithUnit(raw: string | undefined): { n: Decimal; unit: UnitCode | null } | null {
  const m = (raw ?? "").trim().match(/^([\d,]*\.?\d+)\s*([a-z]*)\.?$/i);
  if (!m) return null;
  const n = num(m[1]);
  if (!n) return null;
  if (!m[2]) return { n, unit: null };
  const unit = UNIT_WORDS[m[2].toLowerCase()];
  return unit ? { n, unit } : null;
}

const toGrams = (a: { n: Decimal; unit: UnitCode | null }) => {
  const per = GRAMS_PER[a.unit ?? "G"];
  return per ? a.n.times(per).toDecimalPlaces(4) : null;
};

type Counted = { quantity: Decimal; unit: UnitCode; unitWeightGrams: string | null } | { problem: string } | null;

/** How an NMS2S row is counted: by its Unit/Package Count when it has one, otherwise by its total weight. Null means the row is blank. */
function countNms2s(countCell: string, weightCell: string, perUnitCell: string): Counted {
  const count = num(countCell);
  const weight = amountWithUnit(weightCell);
  if (countCell && !count) return { problem: "Unit/Package Count is not a number." };
  if (weightCell && !weight) return { problem: `"${weightCell}" isn't an amount CannaTrace understands (like 500.00 g).` };
  if (count && count.gt(0)) {
    const perUnit = amountWithUnit(perUnitCell);
    // Amount per unit in milligrams is an edible's dose, not its weight.
    const per = perUnit && perUnit.unit !== "MG" ? toGrams(perUnit) : null;
    const total = weight ? toGrams(weight) : null;
    const each = per && per.gt(0) ? per : total && total.gt(0) ? total.div(count).toDecimalPlaces(4) : null;
    return { quantity: count, unit: "EACH", unitWeightGrams: each ? each.toString() : null };
  }
  if (weight) return { quantity: weight.n, unit: weight.unit ?? "G", unitWeightGrams: null };
  if (count) return { quantity: count, unit: "EACH", unitWeightGrams: null };
  return null;
}

const YES = /^(y|yes|true|1|x|scheduled)$/i;

export const importRoom = (source: Source) => `Imported from ${SOURCE_NAME[source]}`;
/** Kept for the Dutchie tests and callers. */
export const IMPORT_ROOM = importRoom("dutchie");
export const MAX_DUTCHIE_ROWS = 5000;

export function planDutchie(table: string[][]): Plan {
  return planImport("dutchie", table);
}

export function planImport(source: Source, table: string[][]): Plan {
  const IMPORT_ROOM = importRoom(source);
  const problems: string[] = [];
  const warnings: string[] = [];
  const at = findHeader(table, source);
  if (at < 0) {
    return {
      matched: {},
      rows: [],
      problems: [
        source === "flourish"
          ? "This doesn't look like a Flourish package export: no row names columns like Item Name, Package ID, and Quantity."
          : source === "nms2s"
            ? "This doesn't look like an NMS2S inventory list: no row names columns like ID, Product Type, Strain Name, and Total Cannabis Weight."
            : "This doesn't look like a Dutchie inventory report: no row names columns like Product Name, Package ID, and Quantity.",
      ],
      warnings,
    };
  }
  const header = table[at];
  const cols = matchColumns(header, source);
  const matched = Object.fromEntries(Object.entries(cols).map(([f, i]) => [f, header[i as number]])) as Plan["matched"];
  const nms2s = source === "nms2s";
  if (nms2s) {
    if (cols.product === undefined && cols.category === undefined) problems.push("The list has no Product Name or Product Type column.");
    if (cols.quantity === undefined && cols.grams === undefined) problems.push("The list has no Total Cannabis weight or Unit/Package Count column.");
  } else {
    if (cols.product === undefined) problems.push(`The report has no ${source === "flourish" ? "Item Name" : "Product Name"} column.`);
    if (cols.quantity === undefined) problems.push("The report has no Quantity column.");
  }
  if (problems.length) return { matched, rows: [], problems, warnings };

  const body = table.slice(at + 1);
  if (body.length > MAX_DUTCHIE_ROWS) problems.push(`The report has ${body.length.toLocaleString("en-US")} rows; import at most ${MAX_DUTCHIE_ROWS.toLocaleString("en-US")} at a time.`);
  const get = (cells: string[], f: DutchieField) => (cols[f] === undefined ? "" : (cells[cols[f] as number] ?? "").trim());

  const rows: PlanRow[] = [];
  const stores = new Set<string>();
  let skippedEmpty = 0;
  let pendingLab = 0;
  let destroying = 0;
  body.slice(0, MAX_DUTCHIE_ROWS).forEach((cells, i) => {
    const line = at + i + 2;
    // NMS2S leaves Product Name blank until someone names the product; its strain and type describe it.
    const product = get(cells, "product") || (nms2s ? [get(cells, "strain"), get(cells, "category")].filter(Boolean).join(" ") : "");
    if (!product) {
      // Totals and blank lines at the bottom of a report are skipped quietly.
      const filled = cells.filter((c) => c.trim());
      if (filled.length && !filled.some((c) => /^(grand\s+)?totals?:?$/i.test(c.trim()))) warnings.push(`Line ${line} has no product name and was skipped.`);
      return;
    }
    if (YES.test(get(cells, "destroy"))) return void destroying++;
    const tagCell = (get(cells, "externalTag") || get(cells, "tag")).replace(/\s+/g, "");
    if (/^\d+(\.\d+)?e\+?\d+$/i.test(tagCell))
      return void problems.push(`Line ${line} (${product}): the ID ${tagCell} was shortened by Excel into scientific notation. Format the ID column as Text, paste the IDs again, and save.`);
    let quantity: Decimal;
    let unit: UnitCode;
    let unitWeightGrams: string | null;
    if (nms2s) {
      const counted = countNms2s(get(cells, "quantity"), get(cells, "grams"), get(cells, "unitWeight"));
      if (!counted) return void problems.push(`Line ${line} (${product}): there's no weight or count.`);
      if ("problem" in counted) return void problems.push(`Line ${line} (${product}): ${counted.problem}`);
      ({ quantity, unit, unitWeightGrams } = counted);
      if (quantity.lte(0)) return void skippedEmpty++;
    } else {
      const q = num(get(cells, "quantity"));
      if (!q) return void problems.push(`Line ${line} (${product}): Quantity is not a number.`);
      if (q.lte(0)) return void skippedEmpty++;
      quantity = q;
      // "Empty 3.5g Jar" is packaging, not 3.5 g of product: only cannabis items get a weight from their name.
      const supply = /packag|suppl|accessor|merch|hardware|batter|apparel/i.test(get(cells, "category"));
      ({ unit, unitWeightGrams } = unitFor(get(cells, "unit"), quantity, num(get(cells, "grams")), supply ? "" : product, num(get(cells, "unitWeight"))));
    }
    const store = get(cells, "store");
    if (store) stores.add(store);
    // A potency in milligrams (an edible's dose per package) isn't a percent.
    const pct = (f: DutchieField) => (/mg/i.test(get(cells, f)) ? null : num(get(cells, f)));
    const thc = pct("thc");
    const cbd = pct("cbd");
    if (thc || cbd) pendingLab++;
    rows.push({
      line,
      product: product.slice(0, 120),
      sku: get(cells, "sku") || null,
      category: get(cells, "category").slice(0, 60) || "Imported",
      strain: get(cells, "strain") || null,
      tag: tagCell,
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
  if (destroying) warnings.push(`${destroying} package${destroying === 1 ? " is" : "s are"} scheduled for destruction and won't be imported.`);
  if (stores.size > 1) warnings.push(`The report covers ${stores.size} store locations (${[...stores].slice(0, 3).join(", ")}${stores.size > 3 ? ", …" : ""}). Every row goes into the facility you're in now; export one location at a time to keep them apart.`);
  if (cols.room === undefined) warnings.push(`There's no room column, so everything goes into a new room called "${IMPORT_ROOM}". You can move packages afterwards.`);
  if (cols.tag === undefined && cols.externalTag === undefined) warnings.push("There's no package ID column, so every package gets a new CannaTrace ID (PKG-…).");
  if (pendingLab) warnings.push(`${pendingLab} package${pendingLab === 1 ? " has" : "s have"} THC or CBD numbers. They're saved as pending lab results: confirm each with its certificate before it can go on a retail label.`);
  return { matched, rows, problems, warnings };
}
