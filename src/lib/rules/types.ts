/**
 * State rule packs. Each state's rules are data: numbers, plus where each rule comes from
 * and when someone last checked it against the official text. The code that enforces them
 * is shared, so adding a state means writing its pack, not new logic.
 *
 * A wrong number in a compliance tool is worse than none: only add a rule after reading the
 * state's own regulation, and record the citation and the date it was checked.
 */

export type Source = {
  /** The regulation or statute, for example "16.8.2.40(H)(1) NMAC". */
  citation: string;
  /** A link to the official text. */
  url: string;
  /** YYYY-MM-DD the number was last checked against that text. */
  checked: string;
};

type Base = {
  id: string;
  title: string;
  /** One or two plain sentences: what the rule says. */
  summary: string;
  source: Source;
};

export type Rule = Base &
  (
    | {
        /** Most a single customer may buy in one transaction. Missing categories have no cap here. */
        kind: "PURCHASE_LIMIT";
        customer: "ADULT_USE" | "MEDICAL";
        /** Per sale, or per day. The register enforces each sale; daily totals across visits need customer tracking (not yet). */
        period: "TRANSACTION" | "DAY";
        flowerGrams?: number;
        concentrateGrams?: number;
        edibleMg?: number;
        /** Flower and concentrate grams added together may not pass this (Michigan counts both toward 2.5 oz). */
        combinedGrams?: number;
      }
    | { kind: "MIN_AGE"; customer: "ADULT_USE" | "MEDICAL"; years: number }
    /** Product must have a passing lab result before it can be sold at retail. */
    | { kind: "LAB_TEST_BEFORE_RETAIL" }
    /** Waste must be held, then rendered unusable by mixing before destruction. */
    | { kind: "WASTE"; holdHours: number; minMixPercent: number; noticeBusinessDays?: number }
    /** A manifest must exist before transport and cannot change after departure. */
    | { kind: "MANIFEST" }
    /** Inventory must be physically counted at least this often. */
    | { kind: "RECONCILIATION"; everyDays: number; licenseTypes: string[] }
    /** Shown for reference; CannaTrace does not enforce these automatically yet. */
    | { kind: "REFERENCE" }
  );

export type StatePack = {
  state: string;
  name: string;
  regulator: { name: string; url: string };
  trackingSystem: string;
  /** YYYY-MM-DD the pack as a whole was last reviewed. */
  reviewed: string;
  /** Plain words on what the pack covers and what it leaves out. */
  coverage: string;
  rules: Rule[];
};

export type RuleKind = Rule["kind"];

/** How CannaTrace applies a rule, for the rules page. */
export const ENFORCEMENT: Record<RuleKind, string> = {
  PURCHASE_LIMIT: "Enforced at the register",
  MIN_AGE: "Enforced at check-in",
  LAB_TEST_BEFORE_RETAIL: "Enforced at the register",
  WASTE: "Enforced when destroying",
  MANIFEST: "Built into shipping",
  RECONCILIATION: "Checked daily",
  REFERENCE: "For reference",
};
