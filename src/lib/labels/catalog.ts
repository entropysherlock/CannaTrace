import { starterTemplates, STOCK_SIZES, type StarterTemplate } from "./defaults";

/** What a label is for. Drives the gallery's groups and the "help me choose" questions. */
export const USES = [
  { id: "flower", label: "Flower (jars, bags)", group: "Retail products", kind: "PRODUCT" },
  { id: "preroll", label: "Pre-rolls", group: "Retail products", kind: "PRODUCT" },
  { id: "concentrate", label: "Concentrates", group: "Retail products", kind: "PRODUCT" },
  { id: "vape", label: "Vape cartridges", group: "Retail products", kind: "PRODUCT" },
  { id: "edible", label: "Edibles", group: "Retail products", kind: "PRODUCT" },
  { id: "topical", label: "Tinctures and topicals", group: "Retail products", kind: "PRODUCT" },
  { id: "plant", label: "Plants", group: "Growing", kind: "PLANT" },
  { id: "batch", label: "Plant batches and trays", group: "Growing", kind: "BATCH" },
  { id: "harvest", label: "Harvest, drying and bins", group: "Inventory", kind: "PACKAGE" },
  { id: "package", label: "Packages and inventory", group: "Inventory", kind: "PACKAGE" },
  { id: "sample", label: "Lab samples", group: "Inventory", kind: "PACKAGE" },
  { id: "hold", label: "Quarantine and holds", group: "Inventory", kind: "PACKAGE" },
  { id: "transfer", label: "Wholesale transfers", group: "Shipping", kind: "TRANSFER" },
  { id: "shipping", label: "Shipping boxes", group: "Shipping", kind: "TRANSFER" },
] as const;
export type UseId = (typeof USES)[number]["id"];

/** Which uses each starter fits, best first. */
const FITS: Record<string, UseId[]> = {
  "Plant tag 2×1": ["plant"],
  "Plant tag 2×2 (QR code)": ["plant"],
  "Plant tag 4×2 (large, easy to read)": ["plant"],
  "Batch label 4×2": ["batch"],
  "Batch label 2×1": ["batch"],
  "Batch tray tag 3×2 (QR code)": ["batch"],
  "Package label 4×2": ["package"],
  "Package label 4×2 (big barcode)": ["package", "harvest"],
  "Package label 2×1 (quick ID)": ["package"],
  "Harvest bin label 4×6": ["harvest"],
  "Drying rack label 4×3": ["harvest"],
  "Lab sample label 2×1": ["sample"],
  "Quarantine hold label 4×2": ["hold"],
  "Transfer label 4×2": ["transfer"],
  "Transfer label 3×2": ["transfer"],
  "Shipping box label 4×6": ["shipping", "transfer"],
  "NM product label 4×4 (flower)": ["flower", "preroll", "concentrate"],
  "NM product label 4×4 (edible)": ["edible", "topical", "vape"],
  "NM product label 3×4 (flower jar or bag)": ["flower"],
  "NM product label 3×4 (pre-roll)": ["preroll"],
  "NM product label 3×4 (concentrate)": ["concentrate"],
  "NM product label 3×4 (vape cartridge)": ["vape"],
  "NM product label 3×4 (edible)": ["edible"],
  "NM product label 3×4 (tincture or topical)": ["topical"],
};

export type CatalogEntry = StarterTemplate & { uses: UseId[]; group: string };

export function catalog(state: string): CatalogEntry[] {
  return starterTemplates(state).map((t) => {
    const uses = FITS[t.name] ?? [];
    const first = USES.find((u) => u.id === uses[0]);
    return { ...t, uses, group: first?.group ?? "Other" };
  });
}

export type Pick = { entry: CatalogEntry; score: number; reasons: string[] };

const near = (a: number, b: number) => Math.abs(a - b) / b < 0.03;

/**
 * Rank templates for what a person is labelling and the roll they have loaded.
 * `size` is a STOCK_SIZES label, or "" when they don't know (or want to see all sizes).
 */
export function recommend(entries: CatalogEntry[], answers: { use: UseId; size: string }): Pick[] {
  const stock = STOCK_SIZES.find((s) => s.label === answers.size);
  const picks: Pick[] = [];
  for (const entry of entries) {
    const i = entry.uses.indexOf(answers.use);
    if (i < 0) continue;
    const reasons = [`Made for ${USES.find((u) => u.id === answers.use)?.label.toLowerCase()}`];
    let score = 100 - i * 10;
    if (stock) {
      const fits = near(entry.design.widthMm, stock.widthMm) && near(entry.design.heightMm, stock.heightMm);
      const turned = near(entry.design.widthMm, stock.heightMm) && near(entry.design.heightMm, stock.widthMm);
      if (fits) {
        score += 50;
        reasons.push(`Exactly your ${stock.label} roll`);
      } else if (turned) {
        score += 20;
        reasons.push(`Fits your ${stock.label} roll turned sideways`);
      } else if (entry.design.widthMm <= stock.widthMm + 0.5 && entry.design.heightMm <= stock.heightMm + 0.5) {
        score += 15;
        reasons.push(`Smaller than your ${stock.label} roll, so it will fit`);
      } else {
        score -= 40;
        reasons.push(`Bigger than your ${stock.label} roll, so you'd need other stock`);
      }
    }
    if (entry.jurisdiction) reasons.push(`Follows ${entry.jurisdiction} label rules`);
    picks.push({ entry, score, reasons });
  }
  return picks.sort((a, b) => b.score - a.score).slice(0, 4);
}
