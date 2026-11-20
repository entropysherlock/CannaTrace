import Decimal from "decimal.js";
import { COA_FIELDS, type CoaField, type CoaProposal, type CoaValues, type Confidence, type OtherProposal } from "./types";

/**
 * Turns what Claude read from a lab certificate into a proposal a person can check: tidy numbers, which fields
 * are sure or worth a look, and warnings when the numbers disagree with each other. Pure, so it is tested alone.
 */

type Raw = Record<string, unknown>;

const text = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** "24.1", 24.1 or "24.1 %" become "24.1"; anything else is not a percent. Values over 100 are not percents. */
export function cleanPercent(v: unknown): string | null {
  const raw = typeof v === "number" ? String(v) : typeof v === "string" ? v.replace(/[%\s]/g, "").replace(/,/g, ".") : "";
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const d = new Decimal(raw);
  if (d.gt(100)) return null;
  return d.toDecimalPlaces(3).toString();
}

const cleanDate = (v: unknown): string => {
  const s = text(v, 20);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? "" : s;
};

const RESULT: Record<string, string> = { PASS: "PASS", FAIL: "FAIL", PENDING: "PENDING" };

/** `today` is the store's date, so a certificate dated in the future is caught on the store's clock. */
export function proposeCoa(raw: Raw, today: string): CoaProposal | OtherProposal {
  if (raw.document_type !== "COA") return { kind: "OTHER", summary: text(raw.notes, 400) || "This doesn't look like a lab certificate." };
  const uncertain = new Set(Array.isArray(raw.uncertain_fields) ? raw.uncertain_fields.map(String) : []);
  const warnings: string[] = [];
  const values = Object.fromEntries(COA_FIELDS.map((f) => [f, ""])) as CoaValues;
  const confidence = Object.fromEntries(COA_FIELDS.map((f) => [f, "missing"])) as Record<CoaField, Confidence>;
  const set = (field: CoaField, value: string, claudeKey: string) => {
    values[field] = value;
    confidence[field] = value ? (uncertain.has(claudeKey) ? "check" : "ok") : "missing";
  };

  set("labName", text(raw.lab_name, 120), "lab_name");
  const sampleDate = cleanDate(raw.sample_date);
  set("sampleDate", sampleDate, "sample_date");
  if (sampleDate && sampleDate > today) {
    warnings.push(`The sample date ${sampleDate} is in the future. Check the date on the certificate.`);
    confidence.sampleDate = "check";
  }
  const result = RESULT[String(raw.overall_result ?? "").toUpperCase()] ?? "";
  set("result", result, "overall_result");
  const pct: [CoaField, string][] = [
    ["thcPercent", "thc_total_percent"],
    ["cbdPercent", "cbd_total_percent"],
    ["thcaPercent", "thca_percent"],
    ["d9ThcPercent", "d9_thc_percent"],
    ["cbdaPercent", "cbda_percent"],
    ["cbgPercent", "cbg_percent"],
    ["cbnPercent", "cbn_percent"],
    ["totalCannabinoidsPercent", "total_cannabinoids_percent"],
  ];
  for (const [field, key] of pct) {
    const given = raw[key];
    const clean = cleanPercent(given);
    set(field, clean ?? "", key);
    if (clean === null && given !== null && given !== undefined && given !== "") {
      warnings.push(`${key.replace(/_/g, " ")} on the certificate ("${text(given, 20)}") isn't a percentage between 0 and 100, so it was left blank.`);
    }
  }
  set("terpenes", text(raw.terpenes, 300), "terpenes");
  set("notes", text(raw.notes, 300), "notes");

  // Total THC is THCa × 0.877 + Δ9-THC. When the certificate gives the parts, the numbers must agree.
  const thca = values.thcaPercent ? new Decimal(values.thcaPercent) : null;
  const d9 = values.d9ThcPercent ? new Decimal(values.d9ThcPercent) : new Decimal(0);
  if (thca) {
    const expected = thca.mul("0.877").add(d9);
    if (!values.thcPercent) {
      values.thcPercent = expected.toDecimalPlaces(3).toString();
      confidence.thcPercent = "check";
      warnings.push(`Total THC wasn't printed, so it was worked out from THCa × 0.877 + Δ9-THC = ${values.thcPercent}%. Check it against the certificate.`);
    } else if (expected.sub(values.thcPercent).abs().gt(1)) {
      confidence.thcPercent = "check";
      warnings.push(`Total THC ${values.thcPercent}% doesn't match THCa × 0.877 + Δ9-THC (${expected.toDecimalPlaces(2).toString()}%). One of the numbers may have been misread.`);
    }
  }
  if (values.thcPercent && values.totalCannabinoidsPercent && new Decimal(values.totalCannabinoidsPercent).lt(values.thcPercent)) {
    confidence.totalCannabinoidsPercent = "check";
    warnings.push("Total cannabinoids is lower than total THC. One of them may have been misread.");
  }
  if (!values.result) warnings.push("The overall pass or fail result wasn't clear. Choose it before saving.");

  return {
    kind: "COA",
    values,
    confidence,
    identifiers: { tag: text(raw.package_tag, 60), lot: text(raw.batch_or_lot_id, 60), product: text(raw.product_name, 120), sampleId: text(raw.sample_id, 60) },
    warnings,
  };
}
