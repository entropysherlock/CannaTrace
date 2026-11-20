/** Shapes shared by the server and the review screen. Nothing here may import server-only code. */

export type Confidence = "ok" | "check" | "missing";

export const COA_FIELDS = [
  "labName",
  "sampleDate",
  "result",
  "thcPercent",
  "cbdPercent",
  "thcaPercent",
  "d9ThcPercent",
  "cbdaPercent",
  "totalCbdPercent",
  "cbgPercent",
  "cbnPercent",
  "totalCannabinoidsPercent",
  "terpenes",
  "notes",
] as const;
export type CoaField = (typeof COA_FIELDS)[number];
export type CoaValues = Record<CoaField, string>;

/** What was printed on the certificate to say which package it is about. */
export type CoaIdentifiers = { tag: string; lot: string; product: string; sampleId: string };

/** What Claude read from a certificate, cleaned up and checked, ready for a person to look over. */
export type CoaProposal = {
  kind: "COA";
  values: CoaValues;
  confidence: Record<CoaField, Confidence>;
  identifiers: CoaIdentifiers;
  /** Plain-language things worth a second look, such as numbers that don't add up. */
  warnings: string[];
};

/** A document that isn't one we can fill in yet. */
export type OtherProposal = { kind: "OTHER"; summary: string };

/** Any other document Tally recognises: what it found, laid out for checking. Nothing here is saved to a record yet. */
export type DocProposal = {
  kind: "DOC";
  docType: string;
  label: string;
  summary: string;
  fields: { key: string; label: string; value: string; confidence: Confidence }[];
  itemsLabel: string;
  itemColumns: { key: string; label: string }[];
  items: Record<string, string>[];
  /** Rows beyond what is shown. */
  moreItems: number;
  warnings: string[];
  next: string;
};

export type ScanProposal = CoaProposal | OtherProposal | DocProposal;

export type PackageMatch = { id: string; tag: string; itemName: string; quantity: string; unit: string; status: string; reasons: string[]; score: number };
