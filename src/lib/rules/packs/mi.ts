import type { StatePack } from "../types";

const CHECKED = "2026-11-17";
const rule = (n: string) => ({
  citation: `Mich. Admin. Code R ${n}`,
  url: `https://www.law.cornell.edu/regulations/michigan/Mich-Admin-Code-R-${n.replace(".", "-")}`,
  checked: CHECKED,
});

export const MI: StatePack = {
  state: "MI",
  name: "Michigan",
  regulator: { name: "Cannabis Regulatory Agency (CRA)", url: "https://www.michigan.gov/cra" },
  trackingSystem: "Metrc (statewide monitoring system)",
  reviewed: CHECKED,
  coverage:
    "Adult-use per-sale limits, medical daily limit, minimum age, and testing before sale, from the CRA's administrative rules (R 420.506 and R 420.303a). Medical patients' 10-ounce monthly limit and limit checks in the statewide monitoring system are not enforced by Leaf2Sale yet. Infused products count toward the 2.5 oz by weight equivalents, which Leaf2Sale does not calculate yet. Not yet included: waste, labeling, and packaging rules.",
  rules: [
    {
      id: "mi-adult-limit",
      kind: "PURCHASE_LIMIT",
      customer: "ADULT_USE",
      period: "TRANSACTION",
      flowerGrams: 70.87,
      concentrateGrams: 15,
      combinedGrams: 70.87,
      title: "Adult-use per-sale limit",
      summary: "No more than 2.5 ounces of marihuana to an adult 21 or older in one transaction, of which no more than 15 grams may be concentrate, and no more than 3 immature plants.",
      source: rule("420.506"),
    },
    {
      id: "mi-medical-limit",
      kind: "PURCHASE_LIMIT",
      customer: "MEDICAL",
      period: "DAY",
      flowerGrams: 70.87,
      combinedGrams: 70.87,
      title: "Medical daily limit",
      summary:
        "A registered patient may buy no more than 2.5 ounces of marihuana or its equivalent per day and 10 ounces per month. The retailer verifies both in the statewide monitoring system before each sale.",
      source: rule("420.506"),
    },
    {
      id: "mi-age",
      kind: "MIN_AGE",
      customer: "ADULT_USE",
      years: 21,
      title: "Adult-use customers must be 21",
      summary: "Adult-use sales are only to adults 21 years of age or older.",
      source: rule("420.506"),
    },
    {
      id: "mi-lab-before-retail",
      kind: "LAB_TEST_BEFORE_RETAIL",
      title: "Testing before sale",
      summary: "Products may not be transferred or sold to a sales location until passing results for all required safety tests are in the statewide monitoring system.",
      source: {
        citation: "Mich. Admin. Code R 420.303a(2)",
        url: "https://regulations.justia.com/states/michigan/licensing-and-regulatory-affairs/marijuana-regulatoty-agency/marihuana-sampling-and-testing/section-r-420-303a",
        checked: CHECKED,
      },
    },
  ],
};
