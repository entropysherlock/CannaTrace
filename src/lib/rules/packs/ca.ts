import type { StatePack } from "../types";

const REGS = "https://cannabis.ca.gov/wp-content/uploads/sites/2/2025/04/dcc_regulations_04012025.pdf";
const CHECKED = "2026-11-17";
const src = (citation: string) => ({ citation, url: REGS, checked: CHECKED });

export const CA: StatePack = {
  state: "CA",
  name: "California",
  regulator: { name: "Department of Cannabis Control (DCC)", url: "https://www.cannabis.ca.gov/" },
  trackingSystem: "Metrc (California Cannabis Track-and-Trace)",
  reviewed: CHECKED,
  coverage:
    "Adult-use and medicinal daily purchase limits, customer ages, testing before retail sale, and track-and-trace timing, from Title 4, Division 19 of the California Code of Regulations (DCC regulations as of April 1, 2025). Limits are per day: the register enforces them on each sale, but does not yet add up repeat visits by the same customer on one day. Concentrate inside edibles and other products also counts toward the 8 g limit; CannaTrace counts it only for items set up as concentrate. Not yet included: waste handling (§17223), reconciliation timing, packaging and labeling.",
  rules: [
    {
      id: "ca-adult-limit",
      kind: "PURCHASE_LIMIT",
      customer: "ADULT_USE",
      period: "DAY",
      flowerGrams: 28.5,
      concentrateGrams: 8,
      title: "Adult-use daily limit",
      summary: "No more than 28.5 grams of non-concentrated cannabis, 8 grams of concentrate (including concentrate in products), and 6 immature plants to one adult-use customer in a day.",
      source: src("4 CCR §15409(a)"),
    },
    {
      id: "ca-medical-limit",
      kind: "PURCHASE_LIMIT",
      customer: "MEDICAL",
      period: "DAY",
      flowerGrams: 226.8,
      title: "Medicinal daily limit",
      summary: "No more than 8 ounces of medicinal cannabis as dried flower and 12 immature plants to one medicinal customer in a day, unless a physician recommends more.",
      source: src("4 CCR §15409(b)"),
    },
    {
      id: "ca-age-adult",
      kind: "MIN_AGE",
      customer: "ADULT_USE",
      years: 21,
      title: "Adult-use customers must be 21",
      summary: "Retailers may only sell adult-use cannabis goods to people at least 21 years old.",
      source: src("4 CCR §15404(a)"),
    },
    {
      id: "ca-age-medical",
      kind: "MIN_AGE",
      customer: "MEDICAL",
      years: 18,
      title: "Medicinal customers must be 18",
      summary: "Medicinal sales are limited to people at least 18 years old with a valid physician's recommendation.",
      source: src("4 CCR §15404(b)"),
    },
    {
      id: "ca-lab-before-retail",
      kind: "LAB_TEST_BEFORE_RETAIL",
      title: "Testing before retail sale",
      summary: "A batch may go to retailers only after it passes regulatory compliance testing; a batch that fails is not released for retail sale.",
      source: src("4 CCR §15306(c), §15717(c)"),
    },
    {
      id: "ca-destruction-record",
      kind: "REFERENCE",
      title: "Record destruction within 24 hours",
      summary: "Destruction or disposal of cannabis goods is recorded in the track-and-trace system within 24 hours, with the employee, reason, and method.",
      source: src("4 CCR §15049(b)(5), (c)(6)"),
    },
  ],
};
