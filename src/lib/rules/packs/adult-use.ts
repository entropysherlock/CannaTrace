import type { Rule, StatePack } from "../types";

/**
 * Adult-use rule packs for the remaining adult-use states, read from each state's statute,
 * regulation, or regulator notice on 2026-11-17. Every number here has a citation and a link.
 *
 * Kept deliberately narrow: per-sale or per-day purchase limits, the minimum age, and testing
 * before sale where the official text says so. Where a state counts products by an equivalency
 * CannaTrace can't calculate yet (THC in concentrates, edibles by package weight), a REFERENCE
 * rule says so instead of guessing a number.
 */

const CHECKED = "2026-11-17";
const OZ = 28.35;
const g = (oz: number) => Math.round(oz * OZ * 100) / 100;
const src = (citation: string, url: string) => ({ citation, url, checked: CHECKED });
const ASK = "Ask the regulator which tracking system applies";

type LimitInput = Omit<Extract<Rule, { kind: "PURCHASE_LIMIT" }>, "kind" | "customer" | "id"> & { id?: string };

function pack(p: {
  state: string;
  name: string;
  regulator: { name: string; url: string };
  trackingSystem?: string;
  coverage: string;
  limit: LimitInput;
  age: { citation: string; url: string; summary?: string };
  lab?: { citation: string; url: string; summary: string };
  references?: { id: string; title: string; summary: string; citation: string; url: string }[];
}): StatePack {
  const key = p.state.toLowerCase();
  const rules: Rule[] = [
    { ...p.limit, id: p.limit.id ?? `${key}-adult-limit`, kind: "PURCHASE_LIMIT", customer: "ADULT_USE" },
    {
      id: `${key}-age`,
      kind: "MIN_AGE",
      customer: "ADULT_USE",
      years: 21,
      title: "Customers must be 21",
      summary: p.age.summary ?? "Adult-use sales are only to people 21 or older, after checking a valid ID.",
      source: src(p.age.citation, p.age.url),
    },
  ];
  if (p.lab) rules.push({ id: `${key}-lab-before-retail`, kind: "LAB_TEST_BEFORE_RETAIL", title: "Testing before sale", summary: p.lab.summary, source: src(p.lab.citation, p.lab.url) });
  for (const r of p.references ?? []) rules.push({ id: r.id, kind: "REFERENCE", title: r.title, summary: r.summary, source: src(r.citation, r.url) });
  return { state: p.state, name: p.name, regulator: p.regulator, trackingSystem: p.trackingSystem ?? ASK, reviewed: CHECKED, coverage: p.coverage, rules };
}

const NOT_YET = "Not yet included: medical limits, waste, manifests, and labeling.";

export const AK = pack({
  state: "AK",
  name: "Alaska",
  regulator: { name: "Alcohol and Marijuana Control Office (AMCO)", url: "https://www.commerce.alaska.gov/web/amco" },
  coverage: `Daily retail limits (3 AAC 306.355), minimum age (AS 17.38.020), and testing before sale (3 AAC 306.455). Alaska also caps combined THC at 5,600 mg a day across all products; CannaTrace applies that to edibles only. ${NOT_YET}`,
  limit: {
    period: "DAY",
    flowerGrams: OZ,
    concentrateGrams: 7,
    edibleMg: 5600,
    title: "Daily retail limit",
    summary: "A retail store may not sell one person more than 1 ounce of usable marijuana, 7 grams of concentrate for inhalation, or 5,600 mg of THC in combined sales per day.",
    source: src("3 AAC 306.355(a)", "https://www.law.cornell.edu/regulations/alaska/3-AAC-306.355"),
  },
  age: { citation: "AS 17.38.020", url: "https://www.commerce.alaska.gov/web/Portals/9/pub/MCB/StatutesAndRegulations/AS17.38.pdf" },
  lab: {
    citation: "3 AAC 306.455(a)",
    url: "https://regulations.justia.com/states/alaska/title-3/part-19/chapter-306/article-4/section-3-aac-306-455",
    summary: "Marijuana may not be sold or transported until all required laboratory testing is complete.",
  },
});

export const AZ = pack({
  state: "AZ",
  name: "Arizona",
  regulator: { name: "Arizona Department of Health Services (ADHS)", url: "https://www.azdhs.gov/licensing/marijuana/" },
  coverage: `Per-sale limit and ID check (A.R.S. 36-2858, A.A.C. R9-18-309) and testing before sale (R9-18-311). ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: OZ,
    concentrateGrams: 5,
    combinedGrams: OZ,
    title: "Per-sale limit",
    summary: "No more than 1 ounce of marijuana to a consumer in a single transaction, of which no more than 5 grams may be concentrate.",
    source: src("A.A.C. R9-18-309(A)(3); A.R.S. 36-2858", "https://www.law.cornell.edu/regulations/arizona/Ariz-Admin-Code-SS-R9-18-309"),
  },
  age: { citation: "A.R.S. 36-2858; A.A.C. R9-18-309(A)(1)", url: "https://codes.findlaw.com/az/title-36-public-health-and-safety/az-rev-st-sect-36-2858/" },
  lab: {
    citation: "A.A.C. R9-18-311(A), (B)(8)",
    url: "https://www.law.cornell.edu/regulations/arizona/Ariz-Admin-Code-SS-R9-18-311",
    summary: "Only batches whose test results comply with state standards may be offered for sale.",
  },
});

export const CT = pack({
  state: "CT",
  name: "Connecticut",
  regulator: { name: "Department of Consumer Protection (DCP)", url: "https://portal.ct.gov/cannabis" },
  coverage: `Per-transaction limit set by DCP and minimum age. DCP counts other products by flower equivalents CannaTrace doesn't calculate yet, so only the flower number is enforced. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: g(0.5),
    title: "Per-transaction limit",
    summary: "Adult-use sales are limited to 1/2 ounce of raw flower or its equivalent per transaction (since December 1, 2023).",
    source: src(
      "DCP notice, Oct. 31, 2023",
      "https://portal.ct.gov/DCP/News-Releases-from-the-Department-of-Consumer-Protection/2023-News-Releases/Department-of-Consumer-Protection-Announces-Adult-Use-Cannabis-Transaction-Limit-Increase",
    ),
  },
  age: { citation: "DCP adult-use market notice", url: "https://portal.ct.gov/dcp/news-releases-from-the-department-of-consumer-protection/2022-news-releases/consumer-protection-announces-adult-use-cannabis-market-opening-date" },
});

export const DE = pack({
  state: "DE",
  name: "Delaware",
  regulator: { name: "Office of the Marijuana Commissioner (OMC)", url: "https://omc.delaware.gov" },
  coverage: `Per-transaction limit (4 Del. C. § 1332(f)(1), personal use quantity) and minimum age. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: OZ,
    concentrateGrams: 12,
    edibleMg: 750,
    title: "Per-transaction limit",
    summary: "A retail store may not sell more than a personal use quantity in one transaction: 1 ounce of leaf marijuana, 12 grams of concentrate, or products with 750 mg of THC.",
    source: src("4 Del. C. § 1332(f)(1)", "https://law.justia.com/codes/delaware/title-4/chapter-13/subchapter-iii/section-1332"),
  },
  age: { citation: "OMC adult-use FAQ", url: "https://omc.delaware.gov/faq/index.shtml" },
});

export const IL = pack({
  state: "IL",
  name: "Illinois",
  regulator: { name: "Department of Financial and Professional Regulation (IDFPR)", url: "https://idfpr.illinois.gov/profs/adultusecan.html" },
  coverage: `Resident purchase limits as doubled by Public Act 104-0463 (June 12, 2026) and the ID check (410 ILCS 705/15-85). Non-residents get half; CannaTrace can't tell residents apart yet, so staff must check. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: 60,
    concentrateGrams: 10,
    edibleMg: 1000,
    title: "Illinois resident limit",
    summary: "An Illinois resident 21 or older may possess and buy up to 60 grams of flower, 10 grams of concentrate, and 1,000 mg of THC in infused products.",
    source: src("410 ILCS 705/10-10(a), as amended by P.A. 104-0463", "https://idfpr.illinois.gov/content/dam/soi/en/web/idfpr/forms/cannabis/sb-3222-fact-sheet.pdf"),
  },
  age: { citation: "410 ILCS 705/15-85(b)", url: "https://codes.findlaw.com/il/chapter-410-public-health/il-st-sect-410-705-15-85/" },
  references: [
    {
      id: "il-nonresident",
      title: "Visitors get half",
      summary: "Non-residents may buy 30 grams of flower, 5 grams of concentrate, and 500 mg of THC in infused products. Check ID for residency.",
      citation: "410 ILCS 705/10-10(b), as amended by P.A. 104-0463",
      url: "https://idfpr.illinois.gov/content/dam/soi/en/web/idfpr/forms/cannabis/sb-3222-fact-sheet.pdf",
    },
  ],
});

export const ME = pack({
  state: "ME",
  name: "Maine",
  regulator: { name: "Office of Cannabis Policy (OCP)", url: "https://www.maine.gov/dafs/ocp/" },
  coverage: `Per-sale and 24-hour limits (28-B M.R.S. §§ 504, 1501), minimum age, and mandatory testing (§ 602). ${NOT_YET}`,
  limit: {
    period: "DAY",
    flowerGrams: g(2.5),
    concentrateGrams: 10,
    combinedGrams: g(2.5),
    title: "Daily limit",
    summary: "A cannabis store may not sell more than 2.5 ounces of adult use cannabis, including no more than 10 grams of concentrate, in a sale or in any 24-hour period.",
    source: src("28-B M.R.S. § 504(2)(B), (12); § 1501(1)(F)", "https://legislature.maine.gov/statutes/28-B/title28-Bsec1501.html"),
  },
  age: { citation: "28-B M.R.S. § 504", url: "https://legislature.maine.gov/statutes/28-b/title28-Bsec504.html" },
  lab: {
    citation: "28-B M.R.S. § 602",
    url: "https://autodiscover.legislature.maine.gov/statutes/28-B/title28-Bsec602.html",
    summary: "Adult use cannabis may not be sold to a consumer unless mandatory testing shows it is within allowable contaminant limits.",
  },
});

export const MD = pack({
  state: "MD",
  name: "Maryland",
  regulator: { name: "Maryland Cannabis Administration (MCA)", url: "https://cannabis.maryland.gov" },
  trackingSystem: "Metrc",
  coverage: `Daily adult-use dispensing limit (COMAR 14.17.12.04(B)) and minimum age. Testing rules not yet verified against COMAR. ${NOT_YET}`,
  limit: {
    period: "DAY",
    flowerGrams: g(1.5),
    concentrateGrams: 12,
    edibleMg: 750,
    title: "Daily adult-use limit",
    summary: "A dispensary may not dispense more than the personal use amount in a day: 1.5 ounces of usable cannabis, 12 grams of concentrate, or edibles, capsules, and tinctures with 750 mg of THC.",
    source: src("COMAR 14.17.12.04(B)", "https://dsd.maryland.gov/regulations/Pages/14.17.12.04.aspx"),
  },
  age: { citation: "MCA consumer guidance", url: "https://cannabis.maryland.gov/SiteAssets/Pages/BeCannabisSmart/Dispensary%20Do%27s%20and%20Don%27ts.pdf" },
});

export const MA = pack({
  state: "MA",
  name: "Massachusetts",
  regulator: { name: "Cannabis Control Commission (CCC)", url: "https://masscannabiscontrol.com" },
  trackingSystem: "Metrc",
  coverage: `Daily limit raised to 2 ounces by H.5350 (Chapter 65 of the Acts of 2026) and CCC Administrative Order No. 6, minimum age, and testing (935 CMR 500.160). Concentrate is counted by THC content, which CannaTrace doesn't calculate yet. ${NOT_YET}`,
  limit: {
    period: "DAY",
    flowerGrams: g(2),
    edibleMg: 1000,
    title: "Daily limit",
    summary: "A retailer may not knowingly sell more than 2 ounces of marijuana a day, or the equivalent: 10 grams of active THC in concentrate or 1,000 mg of active THC in edibles.",
    source: src("CCC Administrative Order No. 6 (Apr. 19, 2026); 935 CMR 500.140(3)", "https://masscannabiscontrol.com/2026/04/administrative-order-relative-to-equivalency-and-conversion-standards-for-marijuana-products-april-19-2026/"),
  },
  age: { citation: "935 CMR 500.140", url: "https://regulations.justia.com/states/massachusetts/935-cmr/title-935-cmr-500-000/section-500-140" },
  lab: {
    citation: "935 CMR 500.160",
    url: "https://www.law.cornell.edu/regulations/massachusetts/935-CMR-500-160",
    summary: "Products must be tested by an independent lab; results are valid for one year, and products with older results may not be sold until retested.",
  },
  references: [
    {
      id: "ma-concentrate",
      title: "Concentrate counted by THC",
      summary: "The 2-ounce limit equals 10 grams of active THC in concentrate (not product weight). Check concentrate THC by hand until CannaTrace calculates it.",
      citation: "CCC Administrative Order No. 6",
      url: "https://masscannabiscontrol.com/2026/04/administrative-order-relative-to-equivalency-and-conversion-standards-for-marijuana-products-april-19-2026/",
    },
  ],
});

export const MN = pack({
  state: "MN",
  name: "Minnesota",
  regulator: { name: "Office of Cannabis Management (OCM)", url: "https://mn.gov/ocm/" },
  coverage: `Retail sale limits (Minn. Stat. § 342.27) and minimum age (§ 342.09). Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: g(2),
    concentrateGrams: 8,
    edibleMg: 800,
    title: "Sale limit",
    summary: "A retailer may sell up to 2 ounces of adult-use flower, 8 grams of concentrate, and edibles with up to 800 mg of THC.",
    source: src("Minn. Stat. § 342.27", "https://www.revisor.mn.gov/statutes/2025/2025-10-19%2013:12:39+00:00/cite/342.27/pdf"),
  },
  age: { citation: "Minn. Stat. § 342.09", url: "https://www.revisor.mn.gov/statutes/2025/2025-10-19%2013:12:15+00:00/cite/342.09/pdf" },
});

export const MO = pack({
  state: "MO",
  name: "Missouri",
  regulator: { name: "Division of Cannabis Regulation (DCR)", url: "https://health.mo.gov/safety/cannabis/" },
  coverage: `Per-transaction limit (19 CSR 100-1.180) with concentrate and edible amounts from the rule's 1 ounce = 8 g = 800 mg equivalency (19 CSR 100-1.010), minimum age, and testing before sale. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: g(3),
    concentrateGrams: 24,
    edibleMg: 2400,
    title: "Per-transaction limit",
    summary: "No more than 3 ounces of dried, unprocessed marijuana or its equivalent to a consumer in one transaction. One ounce equals 8 grams of concentrate or 800 mg of THC in infused products.",
    source: src("19 CSR 100-1.180(2)(C)1; 19 CSR 100-1.010", "https://regulations.justia.com/states/missouri/title-19/division-100/chapter-1/section-19-csr-100-1-180"),
  },
  age: { citation: "19 CSR 100-1.010", url: "https://health.mo.gov:443/safety/cannabis/pdf/purchases-agent-ids-1-27-23.pdf" },
  lab: {
    citation: "19 CSR 100-1.180(2)(B); 19 CSR 100-1.110",
    url: "https://health.mo.gov/safety/cannabis/pdf/license-guidance-testing-other-1-27-23.pdf",
    summary: "A dispensary may not sell marijuana product until it has been tested and passed mandatory testing.",
  },
});

export const MT = pack({
  state: "MT",
  name: "Montana",
  regulator: { name: "Department of Revenue, Cannabis Control Division", url: "https://revenue.mt.gov/cannabis/" },
  trackingSystem: "Metrc",
  coverage: `Daily sale limits (ARM 42.39.118(2)) and minimum age. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "DAY",
    flowerGrams: OZ,
    concentrateGrams: 8,
    edibleMg: 800,
    title: "Daily limit",
    summary: "An adult may buy up to 1 ounce of usable marijuana a day: 1 ounce of flower, 8 grams of concentrate, or 800 mg of THC in marijuana products.",
    source: src("ARM 42.39.118(2)", "https://revenuefiles.mt.gov/cannabis/safety-awareness/purchasing-power"),
  },
  age: { citation: "Montana Department of Revenue budtender guidance", url: "https://revenue.mt.gov/card/cannabis/safety-awareness/budtender-day" },
});

export const NV = pack({
  state: "NV",
  name: "Nevada",
  regulator: { name: "Cannabis Compliance Board (CCB)", url: "https://ccb.nv.gov" },
  coverage: `Per-transaction limit (NRS 678B.550, since Jan. 1, 2024) and minimum age. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: g(2.5),
    concentrateGrams: g(0.25),
    title: "Per-transaction limit",
    summary: "A cannabis sales facility may not sell a person more than 2.5 ounces of usable cannabis or more than 1/4 ounce of concentrated cannabis in one transaction.",
    source: src("NRS 678B.550", "https://codes.findlaw.com/nv/title-56-regulation-of-cannabis/nv-rev-st-678b-550/"),
  },
  age: { citation: "CCB Know the Law", url: "https://ccb.nv.gov/laws-regulations/" },
});

export const NJ = pack({
  state: "NJ",
  name: "New Jersey",
  regulator: { name: "Cannabis Regulatory Commission (CRC)", url: "https://www.nj.gov/cannabis/" },
  coverage: `Per-transaction limits and testing requirement (N.J.A.C. 17:30-14.3) and minimum age (N.J.S.A. 2C:35-10d). ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: OZ,
    concentrateGrams: 4,
    edibleMg: 1000,
    combinedGrams: OZ,
    title: "Per-transaction limit",
    summary: "No more than 1 ounce of usable cannabis, 4 grams of solid concentrate (or 4 mL of oil), 1,000 mg of THC in ingestible products, or 1 ounce equivalent in combination, per transaction.",
    source: src("N.J.A.C. 17:30-14.3(d)", "https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-17-30-14-3"),
  },
  age: { citation: "N.J.S.A. 2C:35-10d", url: "https://law.justia.com/codes/new-jersey/title-2c/section-2c-35-10d/" },
  lab: {
    citation: "N.J.A.C. 17:30-14.3(f)",
    url: "https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-17-30-14-3",
    summary: "A retailer may only sell cannabis items that have been properly tested, packaged, sealed, and labeled.",
  },
});

export const NY = pack({
  state: "NY",
  name: "New York",
  regulator: { name: "Office of Cannabis Management (OCM)", url: "https://cannabis.ny.gov" },
  coverage: `Possession limits, which retail dispensaries may not sell past, and minimum age, from OCM. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: g(3),
    concentrateGrams: 24,
    title: "Sale limit",
    summary: "Adults 21 or older may possess 3 ounces of cannabis and 24 grams of concentrated cannabis; dispensaries may not sell beyond that.",
    source: src("Cannabis Law; OCM adult-use information", "https://cannabis.ny.gov/adult-use-information/"),
  },
  age: { citation: "OCM adult-use information", url: "https://cannabis.ny.gov/adult-use-information/" },
});

export const OH = pack({
  state: "OH",
  name: "Ohio",
  regulator: { name: "Division of Cannabis Control (DCC)", url: "https://com.ohio.gov/divisions-and-programs/cannabis-control" },
  coverage: `Daily adult-use limits (OAC 1301:18-8-08(A)(2), eff. Aug. 28, 2025) and minimum age (R.C. 3780.01). The 15,000 mg THC limit covers all non-plant products; CannaTrace applies it to edibles only. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "DAY",
    flowerGrams: g(2.5),
    edibleMg: 15000,
    title: "Daily limit",
    summary: "A dispensary may not dispense more than 2.5 ounces of plant material and cannabis products with 15,000 mg of total THC to an adult-use consumer per day.",
    source: src("OAC 1301:18-8-08(A)(2)", "https://codes.ohio.gov/ohio-administrative-code/rule-1301:18-8-08"),
  },
  age: { citation: "R.C. 3780.01(A)(3)", url: "https://codes.ohio.gov/ohio-revised-code/section-3780.01" },
  references: [
    {
      id: "oh-thc-products",
      title: "15,000 mg THC covers vapes and extracts too",
      summary: "Everything that isn't plant material counts toward 15,000 mg of total THC a day, including vapes and extracts. Check those by hand until CannaTrace adds THC per unit for concentrates.",
      citation: "OAC 1301:18-8-08(A)(2)(c)(ii)",
      url: "https://codes.ohio.gov/ohio-administrative-code/rule-1301:18-8-08",
    },
  ],
});

export const OR = pack({
  state: "OR",
  name: "Oregon",
  regulator: { name: "Oregon Liquor and Cannabis Commission (OLCC)", url: "https://www.oregon.gov/olcc/marijuana/" },
  coverage: `Daily retail limits (OAR 845-025-2800(4)) and age check (OAR 845-025-2820(1)). Solid and liquid products are limited by package weight, which CannaTrace doesn't track. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "DAY",
    flowerGrams: g(2),
    concentrateGrams: 10,
    title: "Daily limit",
    summary: "A retailer may not sell a recreational customer more than 2 ounces of usable marijuana or 10 grams of extracts or concentrates at one time or within one day.",
    source: src("OAR 845-025-2800(4)(a)", "https://www.oregon.gov:443/olcc/marijuana/Documents/Posters/PurchaseLimitsPoster.pdf"),
  },
  age: { citation: "OAR 845-025-2820(1)", url: "https://regulations.justia.com/states/oregon/chapter-845/division-25/section-845-025-2820" },
  references: [
    {
      id: "or-products",
      title: "Edibles and drinks by weight",
      summary: "Also no more than 16 ounces of solid cannabinoid products and 72 fluid ounces of liquid products a day.",
      citation: "OAR 845-025-2800(4)(a)",
      url: "https://www.oregon.gov:443/olcc/marijuana/Documents/Posters/PurchaseLimitsPoster.pdf",
    },
  ],
});

export const RI = pack({
  state: "RI",
  name: "Rhode Island",
  regulator: { name: "Cannabis Control Commission (CCC)", url: "https://ccc.ri.gov" },
  coverage: `Purchase limit and minimum age (R.I. Gen. Laws § 21-28.11-22). Other products count through an equivalency table CannaTrace doesn't apply yet. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: OZ,
    title: "Purchase limit",
    summary: "Adults 21 or older may purchase 1 ounce or less of cannabis, or the equivalent amount of concentrate, from a licensed retailer.",
    source: src("R.I. Gen. Laws § 21-28.11-22", "https://law.justia.com/codes/rhode-island/title-21/chapter-21-28-11/section-21-28-11-22"),
  },
  age: { citation: "R.I. Gen. Laws § 21-28.11-22", url: "https://law.justia.com/codes/rhode-island/title-21/chapter-21-28-11/section-21-28-11-22" },
});

export const VT = pack({
  state: "VT",
  name: "Vermont",
  regulator: { name: "Cannabis Control Board (CCB)", url: "https://ccb.vermont.gov" },
  coverage: `Per-transaction limit raised to 2 ounces by Act 176 (2026) and minimum age (7 V.S.A. § 907(b)). Product equivalents come from CCB guidance, not applied yet. Testing rules not yet verified. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: g(2),
    title: "Per-transaction limit",
    summary: "In a single transaction a retailer may provide 2 ounces of cannabis, or the equivalent in cannabis products, to a person 21 or older after checking ID.",
    source: src("7 V.S.A. § 907(b), as amended by Act 176 (2026)", "https://legislature.vermont.gov/Documents/2026/Docs/ACTS/ACT176/ACT176%20As%20Enacted.pdf"),
  },
  age: { citation: "7 V.S.A. § 907(b)", url: "https://legislature.vermont.gov/Documents/2026/Docs/ACTS/ACT176/ACT176%20As%20Enacted.pdf" },
});

export const WA = pack({
  state: "WA",
  name: "Washington",
  regulator: { name: "Liquor and Cannabis Board (LCB)", url: "https://lcb.wa.gov" },
  coverage: `Per-transaction limits (RCW 69.50.360(3)), minimum age, and testing before sale (WAC 314-55-102). Infused products are limited by package weight, which CannaTrace doesn't track. ${NOT_YET}`,
  limit: {
    period: "TRANSACTION",
    flowerGrams: OZ,
    concentrateGrams: 7,
    title: "Per-transaction limit",
    summary: "A retailer may sell a person 21 or older any combination of up to 1 ounce of useable cannabis, 16 ounces of solid infused product, 72 ounces of liquid infused product, and 7 grams of concentrate.",
    source: src("RCW 69.50.360(3)", "https://lawfilesext.leg.wa.gov/biennium/2023-24/Htm/Bill%20Reports/House/1249-S%20HBR%20FBR%2024.htm"),
  },
  age: { citation: "RCW 69.50.360(3)", url: "https://lawfilesext.leg.wa.gov/biennium/2023-24/Htm/Bill%20Reports/House/1249-S%20HBR%20FBR%2024.htm" },
  lab: {
    citation: "WAC 314-55-102(5)",
    url: "https://lawfilesext.leg.wa.gov/law/WAC/WAC%20314%20%20TITLE/WAC%20314%20-%2055%20%20CHAPTER/WAC%20314%20-%2055%20-102.htm",
    summary: "Flower, concentrate, and infused products may not be sold until required quality control testing is complete and passed.",
  },
  references: [
    {
      id: "wa-products",
      title: "Infused products by weight",
      summary: "Edibles are limited to 16 ounces in solid form and 72 ounces in liquid form per transaction (plus 200 mg of THC in low-dose drinks of 4 mg or less per unit).",
      citation: "RCW 69.50.360(3)",
      url: "https://lawfilesext.leg.wa.gov/biennium/2023-24/Htm/Bill%20Reports/House/1249-S%20HBR%20FBR%2024.htm",
    },
  ],
});

export const ADULT_USE_PACKS = { AK, AZ, CT, DE, IL, ME, MD, MA, MN, MO, MT, NV, NJ, NY, OH, OR, RI, VT, WA };
