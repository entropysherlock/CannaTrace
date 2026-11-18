import type { LabelKind } from "./types";

/**
 * Every field a label can show. Values always come from saved records:
 * nothing here is typed in at print time, so a label cannot disagree with inventory.
 * `optional` fields are often blank on purpose (no allergens, no refrigeration needed), so a blank one isn't flagged.
 */
export type FieldGroup = "Business" | "Plant" | "Batch" | "Package" | "Product" | "Potency" | "Cannabinoid profile" | "Product details" | "Order";
export type FieldDef = { key: string; label: string; example: string; kinds: LabelKind[]; group: FieldGroup; optional?: boolean };

const PKG: LabelKind[] = ["PACKAGE", "PRODUCT", "TRANSFER"];
const ALL: LabelKind[] = ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"];

export const FIELDS: FieldDef[] = [
  { key: "facility.name", label: "Facility name", example: "Mesa Verde Grow", kinds: ALL, group: "Business" },
  { key: "facility.license", label: "License number", example: "CCD-0001", kinds: ALL, group: "Business" },
  { key: "facility.state", label: "State", example: "NM", kinds: ALL, group: "Business" },
  { key: "today", label: "Print date", example: "2026-11-17", kinds: ALL, group: "Business" },
  {
    key: "store.warning",
    label: "Store warning (from Register → Store rules)",
    example: "For use only by adults 21 and older. Keep out of reach of children.",
    kinds: PKG,
    group: "Business",
  },
  {
    key: "state.poisonCenter",
    label: "State poison center phone number",
    example: "NM Poison & Drug Information Center 1-800-222-1222",
    kinds: PKG,
    group: "Business",
  },

  { key: "plant.tag", label: "Plant tag", example: "PL-000123", kinds: ["PLANT"], group: "Plant" },
  { key: "plant.strain", label: "Strain", example: "Blue Dream", kinds: ["PLANT"], group: "Plant" },
  { key: "plant.strainType", label: "Strain type", example: "Hybrid", kinds: ["PLANT"], group: "Plant", optional: true },
  { key: "plant.phase", label: "Growth phase", example: "Flowering", kinds: ["PLANT"], group: "Plant" },
  { key: "plant.batch", label: "Batch", example: "BD-2026-11", kinds: ["PLANT"], group: "Plant" },
  { key: "plant.location", label: "Room", example: "Flower 2", kinds: ["PLANT"], group: "Plant" },
  { key: "plant.planted", label: "Date planted", example: "2026-09-02", kinds: ["PLANT"], group: "Plant" },

  { key: "batch.name", label: "Batch name", example: "BD-2026-11", kinds: ["BATCH"], group: "Batch" },
  { key: "batch.strain", label: "Strain", example: "Blue Dream", kinds: ["BATCH"], group: "Batch" },
  { key: "batch.strainType", label: "Strain type", example: "Hybrid", kinds: ["BATCH"], group: "Batch", optional: true },
  { key: "batch.source", label: "Source", example: "Clone", kinds: ["BATCH"], group: "Batch" },
  { key: "batch.count", label: "Plants in batch", example: "48", kinds: ["BATCH"], group: "Batch" },
  { key: "batch.location", label: "Room", example: "Veg 1", kinds: ["BATCH"], group: "Batch" },
  { key: "batch.started", label: "Date started", example: "2026-09-02", kinds: ["BATCH"], group: "Batch" },

  { key: "package.tag", label: "Package ID (track-and-trace tag)", example: "CT-000007", kinds: PKG, group: "Package" },
  { key: "package.lot", label: "Lot number", example: "LOT-1107", kinds: PKG, group: "Package" },
  { key: "package.harvest", label: "Harvest batch ID", example: "BD-H-2026-10", kinds: PKG, group: "Package", optional: true },
  { key: "package.plantBatch", label: "Plant batch", example: "BD-CLONES-02", kinds: PKG, group: "Package", optional: true },
  { key: "package.netQuantity", label: "Net quantity, metric and U.S. (one unit, for items counted each)", example: "3.5 g (0.12 oz)", kinds: PKG, group: "Package" },
  { key: "package.netMetric", label: "Net quantity, metric", example: "3.5 g", kinds: PKG, group: "Package" },
  { key: "package.netUs", label: "Net quantity, U.S.", example: "0.12 oz", kinds: PKG, group: "Package" },
  { key: "package.quantity", label: "Quantity (number only)", example: "28", kinds: PKG, group: "Package" },
  { key: "package.unit", label: "Unit", example: "g", kinds: PKG, group: "Package" },
  { key: "package.status", label: "Package status", example: "Active", kinds: PKG, group: "Package" },
  { key: "package.created", label: "Date packaged / manufactured", example: "2026-11-10", kinds: PKG, group: "Package" },
  { key: "package.harvested", label: "Harvest date", example: "2026-10-28", kinds: PKG, group: "Package" },
  { key: "package.expires", label: "Expiration date", example: "2027-11-10", kinds: PKG, group: "Package" },

  { key: "item.name", label: "Product name", example: "Blue Dream 3.5g", kinds: PKG, group: "Product" },
  { key: "item.sku", label: "SKU", example: "BD-35", kinds: PKG, group: "Product" },
  { key: "item.category", label: "Category", example: "Flower", kinds: PKG, group: "Product" },
  { key: "item.strain", label: "Strain", example: "Blue Dream", kinds: PKG, group: "Product" },
  { key: "item.strainType", label: "Strain type", example: "Hybrid", kinds: PKG, group: "Product", optional: true },
  { key: "item.unitWeight", label: "Unit weight", example: "1 g (0.04 oz)", kinds: PKG, group: "Product" },

  { key: "lab.thc", label: "Total THC % (passed test only)", example: "21.4%", kinds: PKG, group: "Potency" },
  { key: "lab.cbd", label: "CBD % (passed test only)", example: "0.6%", kinds: PKG, group: "Potency", optional: true },
  { key: "lab.thcMg", label: "Total THC per package, mg (lab % × net weight)", example: "749 mg", kinds: PKG, group: "Potency" },
  { key: "lab.cbdMg", label: "Total CBD per package, mg (lab % × net weight)", example: "21 mg", kinds: PKG, group: "Potency", optional: true },
  { key: "item.servings", label: "Servings per unit", example: "10", kinds: PKG, group: "Potency" },
  { key: "item.thcPerServing", label: "THC per serving, mg", example: "10 mg", kinds: PKG, group: "Potency", optional: true },
  { key: "item.cbdPerServing", label: "CBD per serving, mg", example: "<1 mg", kinds: PKG, group: "Potency", optional: true },
  { key: "item.thcPerPackage", label: "THC per package, mg (servings × mg per serving)", example: "100 mg", kinds: PKG, group: "Potency", optional: true },
  { key: "item.cbdPerPackage", label: "CBD per package, mg (servings × mg per serving)", example: "<5 mg", kinds: PKG, group: "Potency", optional: true },
  { key: "lab.status", label: "Lab status", example: "Pass", kinds: PKG, group: "Potency" },
  { key: "lab.name", label: "Testing lab", example: "Scepter Labs", kinds: PKG, group: "Potency" },
  { key: "lab.date", label: "Lab sample date", example: "2026-11-01", kinds: PKG, group: "Potency" },

  { key: "lab.thca", label: "THCa %", example: "23.9%", kinds: PKG, group: "Cannabinoid profile", optional: true },
  { key: "lab.d9thc", label: "Δ9-THC %", example: "0.4%", kinds: PKG, group: "Cannabinoid profile", optional: true },
  { key: "lab.cbda", label: "CBDa %", example: "0.7%", kinds: PKG, group: "Cannabinoid profile", optional: true },
  { key: "lab.totalCbd", label: "Total CBD %", example: "0.6%", kinds: PKG, group: "Cannabinoid profile", optional: true },
  { key: "lab.cbg", label: "CBG %", example: "1.1%", kinds: PKG, group: "Cannabinoid profile", optional: true },
  { key: "lab.cbn", label: "CBN %", example: "0.1%", kinds: PKG, group: "Cannabinoid profile", optional: true },
  { key: "lab.totalCannabinoids", label: "Total cannabinoids %", example: "26.3%", kinds: PKG, group: "Cannabinoid profile", optional: true },
  {
    key: "lab.profile",
    label: "Cannabinoid profile (every value recorded, one line)",
    example: "THCa 23.9% · Δ9-THC 0.4% · CBG 1.1% · CBN 0.1%",
    kinds: PKG,
    group: "Cannabinoid profile",
  },
  {
    key: "lab.terpenes",
    label: "Top terpenes",
    example: "Myrcene 0.82%, Limonene 0.41%, Caryophyllene 0.30%",
    kinds: PKG,
    group: "Cannabinoid profile",
    optional: true,
  },

  { key: "item.directions", label: "Intended use and directions", example: "For inhalation. Light the end and inhale.", kinds: PKG, group: "Product details" },
  {
    key: "item.ingredients",
    label: "Ingredients",
    example: "Sugar, tapioca syrup, pectin, cannabis extract",
    kinds: PKG,
    group: "Product details",
    optional: true,
  },
  { key: "item.allergens", label: "Allergens (Contains …)", example: "Contains: milk, soy", kinds: PKG, group: "Product details", optional: true },
  { key: "item.pesticides", label: "Pesticides used", example: "None", kinds: PKG, group: "Product details" },
  { key: "item.solvents", label: "Solvents and processing aids", example: "Butane, propane", kinds: PKG, group: "Product details", optional: true },
  {
    key: "item.refrigerate",
    label: "Refrigeration statement (when the product needs it)",
    example: "Keep refrigerated.",
    kinds: PKG,
    group: "Product details",
    optional: true,
  },

  { key: "order.number", label: "Order number", example: "SO-01042", kinds: ["TRANSFER"], group: "Order" },
  { key: "order.manifest", label: "Manifest number", example: "MAN-00311", kinds: ["TRANSFER"], group: "Order" },
  { key: "order.customer", label: "Customer", example: "Green Leaf Dispensary", kinds: ["TRANSFER"], group: "Order" },
  { key: "order.customerLicense", label: "Customer license", example: "CCD-0420", kinds: ["TRANSFER"], group: "Order" },
  { key: "order.shipDate", label: "Ship date", example: "2026-11-18", kinds: ["TRANSFER"], group: "Order" },
  { key: "order.position", label: "Package n of total", example: "3 of 12", kinds: ["TRANSFER"], group: "Order" },
];

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function fieldDef(key: string): FieldDef | undefined {
  return BY_KEY.get(key);
}

export function fieldsFor(kind: LabelKind): FieldDef[] {
  return FIELDS.filter((f) => f.kinds.includes(kind));
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g;

/** The field keys a piece of text refers to. */
export function placeholders(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/**
 * Fill {{field}} placeholders. Missing values become an empty string and are reported in `missing`.
 * Text is read in parts separated by " · ": a part whose fields are all blank is left out with its wording,
 * so "Lot {{package.lot}} · Harvest {{package.harvest}}" prints "Lot LOT-7" for a package with no harvest,
 * not a dangling "Harvest".
 */
export function fill(text: string | undefined, values: Record<string, string | null>): { text: string; missing: string[]; unknown: string[] } {
  const missing: string[] = [];
  const unknown: string[] = [];
  const blank = (key: string) => {
    const v = values[key];
    return !BY_KEY.has(key) || v === null || v === undefined || v === "";
  };
  const parts = (text ?? "").split(SEPARATOR).filter((part) => {
    const keys = placeholders(part);
    return keys.length === 0 || !keys.every(blank);
  });
  for (const key of placeholders(text)) {
    if (!BY_KEY.has(key)) unknown.push(key);
    else if (blank(key)) missing.push(key);
  }
  const out = parts.join(SEPARATOR).replace(PLACEHOLDER, (_, key: string) => (blank(key) ? "" : values[key]!));
  return { text: out, missing, unknown };
}

const SEPARATOR = " · ";

/** Example values for previewing a design before choosing real records. */
export function sampleValues(kind: LabelKind): Record<string, string | null> {
  return Object.fromEntries(fieldsFor(kind).map((f) => [f.key, f.example]));
}
