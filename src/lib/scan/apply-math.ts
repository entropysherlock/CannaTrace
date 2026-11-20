/** Small pure helpers for turning a read document into records. Kept apart from the database so they are tested alone. */

export type UnitGuess = "MG" | "G" | "KG" | "OZ" | "LB" | "ML" | "L" | "EACH";

const UNIT_WORDS: Record<string, UnitGuess> = {
  mg: "MG", milligram: "MG", milligrams: "MG",
  g: "G", gr: "G", gram: "G", grams: "G", gm: "G",
  kg: "KG", kilo: "KG", kilos: "KG", kilogram: "KG", kilograms: "KG",
  oz: "OZ", ounce: "OZ", ounces: "OZ",
  lb: "LB", lbs: "LB", pound: "LB", pounds: "LB",
  ml: "ML", milliliter: "ML", milliliters: "ML",
  l: "L", liter: "L", liters: "L", litre: "L",
  ea: "EACH", each: "EACH", unit: "EACH", units: "EACH", pc: "EACH", pcs: "EACH", piece: "EACH", pieces: "EACH", pack: "EACH", packs: "EACH", jar: "EACH", jars: "EACH", bag: "EACH", bags: "EACH", case: "EACH", box: "EACH",
};

/** The app's unit for what a document says ("Grams", "lbs", "ea"). Null when it isn't clear. */
export function unitFromText(text: string | undefined | null): UnitGuess | null {
  const w = String(text ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_WORDS[w] ?? null;
}

/** A license number with punctuation and case removed, so "DEMO-RET-0002" and "demo ret 0002" are the same. */
export const licenseKey = (s: string | undefined | null) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A tag as printed on paper, tidied the way package and plant tags are stored. */
export const tagKey = (s: string | undefined | null) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1));

/** The business a document names: its license number first, then a clear name match. Null when it isn't clear. */
export function matchBusiness<T extends { id: string; name: string; licenseNumber: string }>(name: string, license: string, rows: T[]): T | null {
  const key = licenseKey(license);
  if (key) {
    const byLicense = rows.filter((r) => licenseKey(r.licenseNumber) === key);
    if (byLicense.length === 1) return byLicense[0];
  }
  const want = words(name);
  if (!want.size) return null;
  let found: T | null = null;
  for (const r of rows) {
    const have = words(r.name);
    const shared = [...want].filter((w) => have.has(w)).length;
    if (shared && shared / Math.max(want.size, have.size) >= 0.6) {
      if (found) return null;
      found = r;
    }
  }
  return found;
}

/**
 * Which package an invoice line most likely prices: newest first, preferring one that has no cost yet and,
 * when the vendor is known, one bought from that vendor.
 */
export function pickCostPackage<T extends { id: string; costPerUnit: string | null; vendorId: string | null }>(packagesNewestFirst: T[], vendorId: string): T | null {
  if (!packagesNewestFirst.length) return null;
  const uncosted = packagesNewestFirst.filter((p) => p.costPerUnit === null);
  const pool = uncosted.length ? uncosted : packagesNewestFirst;
  return (vendorId ? pool.find((p) => p.vendorId === vendorId) : undefined) ?? pool[0];
}

/** Today plus a number of days, as YYYY-MM-DD (UTC calendar days). */
export const dayDiff = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
