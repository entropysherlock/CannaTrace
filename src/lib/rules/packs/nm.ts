import type { StatePack } from "../types";

const RULES = "https://www.srca.nm.gov/parts/title16/16.008.0002.html";
const CHECKED = "2026-11-17";
const src = (citation: string) => ({ citation, url: RULES, checked: CHECKED });

export const NM: StatePack = {
  state: "NM",
  name: "New Mexico",
  regulator: { name: "Cannabis Control Division (RLD)", url: "https://www.rld.nm.gov/cannabis/" },
  trackingSystem: "NMS2S (New Mexico Seed-to-Sale), which replaced BioTrack in September 2026",
  reviewed: CHECKED,
  coverage:
    "Adult-use purchase limits, minimum age, testing before retail sale, waste handling, manifests, recalls, monthly reconciliation, and record keeping, from 16.8.2 NMAC. Not yet included: the new NMS2S medical purchase-limit model, producer plant-count limits (16.8.8 NMAC), and packaging and labeling rules.",
  rules: [
    {
      id: "nm-adult-limit",
      kind: "PURCHASE_LIMIT",
      customer: "ADULT_USE",
      period: "TRANSACTION",
      flowerGrams: 56.7,
      concentrateGrams: 16,
      edibleMg: 800,
      title: "Adult-use purchase limit",
      summary: "No more than 2 ounces of cannabis, 16 grams of extract, 800 mg of edibles, and 6 immature plants to one customer at one time.",
      source: src("16.8.2.40(H)(1) NMAC"),
    },
    {
      id: "nm-min-age",
      kind: "MIN_AGE",
      customer: "ADULT_USE",
      years: 21,
      title: "Adult-use customers must be 21",
      summary: "Retailers may only sell adult-use cannabis to people at least 21 years old, after checking ID.",
      source: src("16.8.2.40(E)(1) NMAC"),
    },
    {
      id: "nm-lab-before-retail",
      kind: "LAB_TEST_BEFORE_RETAIL",
      title: "Lab testing before sale",
      summary: "A product can only be made available for sale after it has passed the laboratory testing the state requires.",
      source: src("16.8.2.40(G)(1)(d) NMAC"),
    },
    {
      id: "nm-waste",
      kind: "WASTE",
      holdHours: 72,
      minMixPercent: 50,
      noticeBusinessDays: 5,
      title: "Waste handling",
      summary:
        "Waste is held in a secured area for at least 72 hours, rendered unusable by mixing with at least 50% non-cannabis material by volume, and reported to the division within 5 business days.",
      source: src("16.8.2.15 NMAC"),
    },
    {
      id: "nm-manifest",
      kind: "MANIFEST",
      title: "Transport manifests",
      summary:
        "A manifest is created before transport and cannot be voided or changed after the shipment leaves. If the state system is down, complete it outside the system and email it to the division and the receiver.",
      source: src("16.8.2.13 NMAC"),
    },
    {
      id: "nm-reconciliation",
      kind: "RECONCILIATION",
      everyDays: 31,
      licenseTypes: ["RETAIL", "MICROBUSINESS"],
      title: "Monthly inventory reconciliation",
      summary: "Retailers reconcile their inventory at least once every calendar month and report suspected theft or loss.",
      source: src("16.8.2.40(K) NMAC"),
    },
    {
      id: "nm-recall",
      kind: "REFERENCE",
      title: "Recalls reported within 24 hours",
      summary: "Keep written recall procedures, and notify the division within 24 hours of starting a recall.",
      source: src("16.8.2.11 NMAC"),
    },
    {
      id: "nm-sales-records",
      kind: "REFERENCE",
      title: "Sales records kept 12 months",
      summary:
        "Each sale records the employee's first name and number, date and time, products and quantities, prices, and excise tax. Retail records are kept at least 12 months. CannaTrace records all of this on every sale and never deletes it.",
      source: src("16.8.2.40(L) NMAC"),
    },
  ],
};
