import type { StatePack } from "../types";

const STATUTE = "https://colorado.public.law/statutes/crs_44-10-601";
const CHECKED = "2026-11-17";
const src = (citation: string, url = STATUTE) => ({ citation, url, checked: CHECKED });

export const CO: StatePack = {
  state: "CO",
  name: "Colorado",
  regulator: { name: "Marijuana Enforcement Division (MED)", url: "https://sbg.colorado.gov/med" },
  trackingSystem: "Metrc",
  reviewed: CHECKED,
  coverage:
    "Retail per-sale flower limit, daily concentrate limit, and minimum age, from the Colorado Retail Marijuana Code (C.R.S. 44-10-601). Colorado counts edibles and concentrate toward the 1 ounce through equivalents set by MED rule (1 CCR 212-3); those equivalents are not in this pack yet, so set your store's edible limit to match. Not yet included: medical limits, testing, waste, and labeling rules.",
  rules: [
    {
      id: "co-retail-limit",
      kind: "PURCHASE_LIMIT",
      customer: "ADULT_USE",
      period: "TRANSACTION",
      flowerGrams: 28.35,
      concentrateGrams: 8,
      title: "Retail sales limit",
      summary: "A retail store may not sell more than one ounce of retail marijuana, or its equivalent in products, in one transaction, and no more than 8 grams of concentrate to a person in a day.",
      source: src("C.R.S. 44-10-601(3)(a), (17)"),
    },
    {
      id: "co-age",
      kind: "MIN_AGE",
      customer: "ADULT_USE",
      years: 21,
      title: "Customers must be 21",
      summary: "Before a sale, staff check a valid ID showing the buyer is 21 or older.",
      source: src("C.R.S. 44-10-601(3)(b)"),
    },
  ],
};
