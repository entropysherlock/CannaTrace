import type { LabelElement, LabelKind } from "./types";

/**
 * State label rules that CannaTrace checks. Every rule names its source and the date it was read.
 * A state or label type that is not listed here has no verified label rules: the checker says so
 * instead of guessing, and never applies one state's rules to another.
 */

export type LabelRuleCheck =
  /** The template must show this field (in a text element, or a barcode for the track-and-trace id). */
  | { type: "field"; field: string; bold?: boolean; bottomFraction?: number }
  /** The template must contain this exact wording (spaces and line breaks don't matter). */
  | { type: "statement"; text: string; bold?: boolean }
  /** The template must contain an image marked as the state logo, at least this size. */
  | { type: "logo"; minMm: number }
  /** CannaTrace cannot check this from its records; a person has to confirm it. */
  | { type: "manual" };

export type LabelRule = {
  id: string;
  /** What the rule asks for, in plain words. */
  title: string;
  citation: string;
  check: LabelRuleCheck;
  /** Items in the information panel may instead be reached through a static QR code (16.8.3.9(L)). */
  qrAllowed?: boolean;
};

export type LabelRulePack = {
  state: string;
  name: string;
  version: string;
  source: string;
  url: string;
  checked: string;
  /** Which label types the rules cover. */
  appliesTo: LabelKind[];
  rules: LabelRule[];
  notes: string[];
};

const NM_URL = "https://www.srca.nm.gov/parts/title16/16.008.0003.html";
const NM_WARNING =
  "For use only by adults 21 and older. Keep out of reach of children. Do not drive a motor vehicle or operate machinery while under the influence of cannabis. BE CAUTIOUS. Cannabinoid edibles can take up to two hours or more to take effect.";

export const NM_LABEL_PACK: LabelRulePack = {
  state: "NM",
  name: "New Mexico finished product labeling",
  version: "2026-11-17",
  source: "16.8.3.9 NMAC, Cannabis Finished Product Labeling",
  url: NM_URL,
  checked: "2026-11-17",
  appliesTo: ["PRODUCT"],
  rules: [
    { id: "nm-identity", title: "Product name in bold", citation: "16.8.3.9(K)(1) NMAC", check: { type: "field", field: "item.name", bold: true } },
    {
      id: "nm-net-qty",
      title: "Net quantity, in the bottom 30% of the display panel",
      citation: "16.8.3.9(K)(2) NMAC",
      check: { type: "field", field: "package.quantity", bottomFraction: 0.3 },
    },
    { id: "nm-thc", title: "Total THC from a testing lab, in bold", citation: "16.8.3.9(K)(3) NMAC", check: { type: "field", field: "lab.thc", bold: true } },
    { id: "nm-logo", title: "Division cannabis logo, at least 1/2 inch square", citation: "16.8.3.9(K)(4) NMAC", check: { type: "logo", minMm: 12.7 } },
    { id: "nm-warning", title: "The required warning statement, in bold", citation: "16.8.3.9(K)(7) NMAC", check: { type: "statement", text: NM_WARNING, bold: true } },
    { id: "nm-maker", title: "Manufacturer business name", citation: "16.8.3.9(L)(1) NMAC", check: { type: "field", field: "facility.name" }, qrAllowed: true },
    { id: "nm-license", title: "Manufacturer license number", citation: "16.8.3.9(L)(3) NMAC", check: { type: "field", field: "facility.license" }, qrAllowed: true },
    { id: "nm-date", title: "Date manufactured", citation: "16.8.3.9(L)(5) NMAC", check: { type: "field", field: "package.created" }, qrAllowed: true },
    { id: "nm-trace", title: "State track-and-trace number", citation: "16.8.3.9(L)(13) NMAC", check: { type: "field", field: "package.tag" }, qrAllowed: true },
    {
      id: "nm-fda",
      title: "FDA disclaimer",
      citation: "16.8.3.9(L)(10) NMAC",
      check: { type: "statement", text: "This product is not approved by the FDA to treat, cure, or prevent any disease." },
      qrAllowed: true,
    },
    {
      id: "nm-health",
      title: "Statement on long-term health effects, including risks when pregnant or breastfeeding (the rule doesn't give fixed wording)",
      citation: "16.8.3.9(L)(10) NMAC",
      check: { type: "manual" },
      qrAllowed: true,
    },
    { id: "nm-cbd", title: "CBD percent, if the lab detected CBD", citation: "16.8.3.9(K)(3)(c) NMAC", check: { type: "manual" } },
    { id: "nm-pesticide", title: "Pesticides used by the producer", citation: "16.8.3.9(L)(4) NMAC", check: { type: "manual" }, qrAllowed: true },
    { id: "nm-ingredients", title: "Ingredients, allergens, and nutrition facts where they apply", citation: "16.8.3.9(L)(6)-(9) NMAC", check: { type: "manual" }, qrAllowed: true },
    { id: "nm-poison", title: "New Mexico poison and drug information center phone number", citation: "16.8.3.9(L)(11) NMAC", check: { type: "manual" }, qrAllowed: true },
    { id: "nm-expiry", title: "Expiration date (CannaTrace does not store one yet)", citation: "16.8.3.9(L)(12) NMAC", check: { type: "manual" }, qrAllowed: true },
    { id: "nm-solvents", title: "Solvents and processing aids, where used", citation: "16.8.3.9(L)(14) NMAC", check: { type: "manual" }, qrAllowed: true },
    { id: "nm-special", title: "Edible serving potency, refrigeration statement, and microbusiness or equity logo, where they apply", citation: "16.8.3.9(K)(3)(a), (K)(5)-(6) NMAC", check: { type: "manual" } },
  ],
  notes: [
    "Covers finished product labels only. Seed and immature plant labels (16.8.3.10 NMAC) and internal inventory, plant, and transfer tags are not checked against state rules.",
    "Items marked for a person to confirm can't be checked from CannaTrace records.",
    "Small edible containers may use the reduced label in 16.8.3.9(M) NMAC; CannaTrace checks the full label.",
  ],
};

export const LABEL_PACKS: Record<string, LabelRulePack> = { NM: NM_LABEL_PACK };

export function labelPackFor(state: string | null | undefined): LabelRulePack | null {
  if (!state) return null;
  return LABEL_PACKS[state.toUpperCase()] ?? null;
}

/** Collapse spacing so wording matches no matter how it was broken across lines. */
export function normalizeWords(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Elements that show a field, either as text or (for ids) inside a barcode or QR. */
export function elementsShowing(elements: LabelElement[], field: string, opts: { textOnly?: boolean } = {}): LabelElement[] {
  const needle = new RegExp(`\\{\\{\\s*${field.replace(".", "\\.")}\\s*\\}\\}`);
  return elements.filter((el) => {
    if (el.type === "text") return needle.test(el.text ?? "");
    if (!opts.textOnly && (el.type === "barcode" || el.type === "qr")) return needle.test(el.value ?? "");
    return false;
  });
}
