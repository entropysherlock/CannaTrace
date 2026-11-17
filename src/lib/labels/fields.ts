import type { LabelKind } from "./types";

/**
 * Every field a label can show. Values always come from saved records:
 * nothing here is typed in at print time, so a label cannot disagree with inventory.
 */
export type FieldDef = { key: string; label: string; example: string; kinds: LabelKind[] };

const PKG: LabelKind[] = ["PACKAGE", "PRODUCT", "TRANSFER"];

export const FIELDS: FieldDef[] = [
  { key: "facility.name", label: "Facility name", example: "Mesa Verde Grow", kinds: ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"] },
  { key: "facility.license", label: "License number", example: "CCD-0001", kinds: ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"] },
  { key: "facility.state", label: "State", example: "NM", kinds: ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"] },
  { key: "today", label: "Print date", example: "2026-11-17", kinds: ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"] },
  { key: "store.warning", label: "Store warning (from Register → Store rules)", example: "For use only by adults 21 and older. Keep out of reach of children.", kinds: ["PACKAGE", "PRODUCT", "TRANSFER"] },

  { key: "plant.tag", label: "Plant tag", example: "PL-000123", kinds: ["PLANT"] },
  { key: "plant.strain", label: "Strain", example: "Blue Dream", kinds: ["PLANT"] },
  { key: "plant.phase", label: "Growth phase", example: "Flowering", kinds: ["PLANT"] },
  { key: "plant.batch", label: "Batch", example: "BD-2026-11", kinds: ["PLANT"] },
  { key: "plant.location", label: "Room", example: "Flower 2", kinds: ["PLANT"] },
  { key: "plant.planted", label: "Date planted", example: "2026-09-02", kinds: ["PLANT"] },

  { key: "batch.name", label: "Batch name", example: "BD-2026-11", kinds: ["BATCH"] },
  { key: "batch.strain", label: "Strain", example: "Blue Dream", kinds: ["BATCH"] },
  { key: "batch.source", label: "Source", example: "Clone", kinds: ["BATCH"] },
  { key: "batch.count", label: "Plants in batch", example: "48", kinds: ["BATCH"] },
  { key: "batch.location", label: "Room", example: "Veg 1", kinds: ["BATCH"] },
  { key: "batch.started", label: "Date started", example: "2026-09-02", kinds: ["BATCH"] },

  { key: "package.tag", label: "Package tag", example: "CT-000007", kinds: PKG },
  { key: "package.quantity", label: "Quantity", example: "28", kinds: PKG },
  { key: "package.unit", label: "Unit", example: "g", kinds: PKG },
  { key: "package.lot", label: "Lot number", example: "LOT-1107", kinds: PKG },
  { key: "package.status", label: "Package status", example: "Active", kinds: PKG },
  { key: "package.created", label: "Date packaged", example: "2026-11-10", kinds: PKG },
  { key: "package.harvested", label: "Harvest date", example: "2026-10-28", kinds: PKG },
  { key: "item.name", label: "Product name", example: "Blue Dream 3.5g", kinds: PKG },
  { key: "item.sku", label: "SKU", example: "BD-35", kinds: PKG },
  { key: "item.category", label: "Category", example: "Flower", kinds: PKG },
  { key: "item.strain", label: "Strain", example: "Blue Dream", kinds: PKG },

  { key: "lab.status", label: "Lab status", example: "Pass", kinds: PKG },
  { key: "lab.name", label: "Testing lab", example: "Scepter Labs", kinds: PKG },
  { key: "lab.date", label: "Lab sample date", example: "2026-11-01", kinds: PKG },
  { key: "lab.thc", label: "Total THC % (passed test only)", example: "21.4%", kinds: PKG },
  { key: "lab.cbd", label: "CBD % (passed test only)", example: "0.6%", kinds: PKG },

  { key: "order.number", label: "Order number", example: "SO-01042", kinds: ["TRANSFER"] },
  { key: "order.manifest", label: "Manifest number", example: "MAN-00311", kinds: ["TRANSFER"] },
  { key: "order.customer", label: "Customer", example: "Green Leaf Dispensary", kinds: ["TRANSFER"] },
  { key: "order.customerLicense", label: "Customer license", example: "CCD-0420", kinds: ["TRANSFER"] },
  { key: "order.shipDate", label: "Ship date", example: "2026-11-18", kinds: ["TRANSFER"] },
  { key: "order.position", label: "Package n of total", example: "3 of 12", kinds: ["TRANSFER"] },
];

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function fieldDef(key: string): FieldDef | undefined {
  return BY_KEY.get(key);
}

export function fieldsFor(kind: LabelKind): FieldDef[] {
  return FIELDS.filter((f) => f.kinds.includes(kind));
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

/** The field keys a piece of text refers to. */
export function placeholders(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** Fill {{field}} placeholders. Missing values become an empty string and are reported in `missing`. */
export function fill(text: string | undefined, values: Record<string, string | null>): { text: string; missing: string[]; unknown: string[] } {
  const missing: string[] = [];
  const unknown: string[] = [];
  const out = (text ?? "").replace(PLACEHOLDER, (_, key: string) => {
    if (!BY_KEY.has(key)) {
      unknown.push(key);
      return "";
    }
    const v = values[key];
    if (v === null || v === undefined || v === "") {
      missing.push(key);
      return "";
    }
    return v;
  });
  return { text: out, missing, unknown };
}

/** Example values for previewing a design before choosing real records. */
export function sampleValues(kind: LabelKind): Record<string, string | null> {
  return Object.fromEntries(fieldsFor(kind).map((f) => [f.key, f.example]));
}
