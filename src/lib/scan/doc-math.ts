import Decimal from "decimal.js";
import { DOC_BY_TYPE, SENSITIVE_ID, SENSITIVE_NOTE, type DocField } from "./documents";
import type { Confidence, DocProposal, OtherProposal } from "./types";

/**
 * Turns what Claude read from any non-certificate document into a proposal a person can check: tidy values, which
 * ones are sure, and plain warnings when the document disagrees with itself. Pure, so it is tested alone.
 */

type Raw = Record<string, unknown>;
const MAX_ROWS = 300;

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");

const cleanDate = (v: unknown): string => {
  const s = text(v, 20);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? "" : s;
};

/** "$1,234.50", 1234.5 and "1 234,50" style values become plain numbers; anything else is not one. */
export function cleanNumber(v: unknown): string | null {
  let s = typeof v === "number" ? String(v) : typeof v === "string" ? v.replace(/[$€£\s]/g, "") : "";
  if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  s = s.replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s).toDecimalPlaces(4).toString();
}

function value(field: DocField, raw: unknown): { value: string; bad: boolean } {
  if (raw === null || raw === undefined || raw === "") return { value: "", bad: false };
  if (field.kind === "date") {
    const d = cleanDate(raw);
    return d ? { value: d, bad: false } : { value: text(raw, 40), bad: true };
  }
  if (field.kind === "money" || field.kind === "number") {
    const n = cleanNumber(raw);
    return n !== null ? { value: n, bad: false } : { value: text(raw, 40), bad: true };
  }
  return { value: text(raw), bad: false };
}

const dayNumber = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86_400_000);
const num = (s: string | undefined) => (s !== undefined && s !== "" && cleanNumber(s) !== null ? new Decimal(cleanNumber(s)!) : null);

export function proposeDocument(raw: Raw, today: string): DocProposal | OtherProposal {
  const type = text(raw.document_type, 40);
  const summary = text(raw.summary, 300) || text(raw.notes, 300);
  if (type === SENSITIVE_ID) {
    return { kind: "DOC", docType: SENSITIVE_ID, label: "Customer ID or patient card", summary: SENSITIVE_NOTE, fields: [], itemsLabel: "", itemColumns: [], items: [], moreItems: 0, warnings: [], next: "Nothing was read from it. You can delete it from the inbox." };
  }
  const def = DOC_BY_TYPE.get(type);
  if (!def) return { kind: "OTHER", summary: summary || "Tally couldn't tell what this document is." };

  const uncertain = new Set(Array.isArray(raw.uncertain_fields) ? raw.uncertain_fields.map(String) : []);
  const got = raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? (raw.fields as Raw) : {};
  const warnings: string[] = [];
  const fields = def.fields.map((fd) => {
    const v = value(fd, got[fd.key]);
    let confidence: Confidence = v.value ? "ok" : "missing";
    if (v.value && (v.bad || uncertain.has(fd.key))) confidence = "check";
    if (v.bad) warnings.push(`${fd.label} "${v.value}" doesn't look like ${fd.kind === "date" ? "a date" : "a number"}. Check it against the document.`);
    return { key: fd.key, label: fd.label, value: v.value, confidence };
  });
  const byKey = new Map(fields.map((x) => [x.key, x.value]));

  const rawItems = Array.isArray(raw.items) ? raw.items.filter((r): r is Raw => Boolean(r) && typeof r === "object") : [];
  const cols = def.itemColumns ?? [];
  const items = rawItems.slice(0, MAX_ROWS).map((row) => {
    const out: Record<string, string> = {};
    for (const c of cols) out[c.key] = value(c, row[c.key]).value;
    return out;
  });
  const moreItems = Math.max(0, rawItems.length - MAX_ROWS);

  // Lines that don't multiply out, and totals that don't add up
  if (cols.some((c) => c.key === "lineTotal")) {
    const off: number[] = [];
    let sum = new Decimal(0);
    let allTotals = items.length > 0;
    items.forEach((r, i) => {
      const q = num(r.quantity), p = num(r.unitPrice), t = num(r.lineTotal);
      if (t) sum = sum.plus(t);
      else allTotals = false;
      if (q && p && t && q.mul(p).minus(t).abs().gt(0.02)) off.push(i + 1);
    });
    if (off.length) warnings.push(`Quantity × price doesn't match the line total on ${off.length === 1 ? "line" : "lines"} ${off.slice(0, 6).join(", ")}${off.length > 6 ? "…" : ""}.`);
    const subtotal = num(byKey.get("subtotal")), total = num(byKey.get("total")), tax = num(byKey.get("tax"));
    const expected = subtotal ?? (total && !tax ? total : null);
    if (allTotals && expected && sum.minus(expected).abs().gt(0.05)) warnings.push(`The lines add up to ${sum.toFixed(2)}, but the document says ${expected.toFixed(2)}.`);
  }

  // The same tag twice
  for (const tagKey of ["packageTag", "plantTag"]) {
    if (!cols.some((c) => c.key === tagKey)) continue;
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of items) {
      const t = (r[tagKey] ?? "").toUpperCase();
      if (!t) continue;
      if (seen.has(t)) dup.add(t);
      seen.add(t);
    }
    if (dup.size) warnings.push(`${[...dup].slice(0, 4).join(", ")} appears more than once.`);
  }

  // Harvest weights
  if (type === "HARVEST_SHEET") {
    const total = num(byKey.get("totalWetWeight"));
    const units = new Set(items.map((r) => (r.unit ?? "").toLowerCase()).filter(Boolean));
    const sum = items.reduce((a, r) => a.plus(num(r.wetWeight) ?? 0), new Decimal(0));
    if (total && items.length && units.size <= 1 && sum.minus(total).abs().gt(0.5)) warnings.push(`The plant weights add up to ${sum.toString()}, but the sheet's total says ${total.toString()}.`);
  }

  // Dates that matter
  const expiry = byKey.get("expiryDate");
  if (type === "LICENSE" && expiry && /^\d{4}-/.test(expiry)) {
    const days = dayNumber(expiry) - dayNumber(today);
    if (days < 0) warnings.push(`This expired ${-days} day${days === -1 ? "" : "s"} ago.`);
    else if (days <= 60) warnings.push(`This expires in ${days} day${days === 1 ? "" : "s"}.`);
  }
  const deadline = byKey.get("deadline") || byKey.get("dueDate");
  if ((type === "STATE_NOTICE" || type === "TAX_FORM") && deadline && /^\d{4}-/.test(deadline)) {
    const days = dayNumber(deadline) - dayNumber(today);
    if (days < 0) warnings.push(`The deadline passed ${-days} day${days === -1 ? "" : "s"} ago.`);
    else if (days <= 14) warnings.push(`The deadline is in ${days} day${days === 1 ? "" : "s"}.`);
  }
  if (type === "WASTE_RECORD" && !byKey.get("reason")) warnings.push("No reason is written. A reason is needed for any destruction record.");
  if (type === "WASTE_RECORD" && !byKey.get("witness")) warnings.push("No witness is written.");

  return { kind: "DOC", docType: type, label: def.label, summary: summary || def.label, fields, itemsLabel: def.itemsLabel ?? "", itemColumns: cols.map((c) => ({ key: c.key, label: c.label })), items, moreItems, warnings, next: def.next };
}
