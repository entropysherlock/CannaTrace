import { STOCK_SIZES } from "./defaults";
import { fieldDef, fieldsFor, placeholders } from "./fields";
import { fitText } from "./text";
import type { BarcodeFormat, ElementType, LabelDesign, LabelElement, LabelKind } from "./types";
import { LABEL_KINDS } from "./types";

/**
 * Turning what Claude read off a photo or scan of an existing label into a label design. Pure, so it can be
 * tested without calling anything. Everything here treats the reading as untrusted: positions are clamped,
 * unknown fields are turned back into the printed words, and the result still goes through the normal design checks.
 */

export type ReadElement = {
  type?: string;
  /** Position and size as fractions (0 to 1) of the label's width and height, from the top-left corner. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Text with {{field}} placeholders where the printed words are specific to one record. */
  text?: string | null;
  /** The words exactly as printed. */
  printed_text?: string | null;
  font_size_pt?: number | null;
  bold?: boolean | null;
  align?: string | null;
  /** For barcodes and QR codes: a {{field}} placeholder, or the printed data. */
  value?: string | null;
  barcode_format?: string | null;
  image_role?: string | null;
  stroke_mm?: number | null;
};

export type LabelReading = {
  label_kind?: string | null;
  suggested_name?: string | null;
  state?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  elements?: ReadElement[] | null;
  /** Printed values that look specific to a record but matched no field. */
  unmatched?: string[] | null;
  notes?: string | null;
};

export type ImportResult = {
  kind: LabelKind;
  name: string;
  jurisdiction: string | null;
  design: LabelDesign;
  /** What each piece of text became, so a person can check the matching. */
  matches: { printed: string; became: string; fields: string[] }[];
  unmatched: string[];
  notes: string[];
};

const TYPES: ElementType[] = ["text", "barcode", "qr", "image", "line", "box"];
const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};
const round = (n: number) => Math.round(n * 100) / 100;

/** The closest standard label size, if the reading is within a few percent of one. */
export function snapToStock(widthMm: number, heightMm: number): { widthMm: number; heightMm: number } {
  for (const s of STOCK_SIZES) {
    if (Math.abs(s.widthMm - widthMm) / s.widthMm < 0.06 && Math.abs(s.heightMm - heightMm) / s.heightMm < 0.06) return { widthMm: s.widthMm, heightMm: s.heightMm };
  }
  return { widthMm: round(widthMm), heightMm: round(heightMm) };
}

const DEFAULT_ID_FIELD: Record<LabelKind, string> = { PLANT: "plant.tag", BATCH: "batch.name", PACKAGE: "package.tag", PRODUCT: "package.tag", TRANSFER: "package.tag" };

/** Keep placeholders that name a field this kind of label has. Returns the text and which fields stayed. */
function checkPlaceholders(text: string, kind: LabelKind): { text: string; fields: string[]; dropped: boolean } {
  const ok = new Set(fieldsFor(kind).map((f) => f.key));
  const fields: string[] = [];
  let dropped = false;
  for (const key of placeholders(text)) {
    if (ok.has(key) && fieldDef(key)) fields.push(key);
    else dropped = true;
  }
  return { text, fields, dropped };
}

/**
 * Build a design from a reading. `aspect` (width / height of the photographed page) fills in a missing size.
 */
export function designFromReading(reading: LabelReading, opts: { aspect?: number | null; kind?: LabelKind } = {}): ImportResult {
  const kind: LabelKind = opts.kind ?? (LABEL_KINDS.some((k) => k.kind === reading.label_kind) ? (reading.label_kind as LabelKind) : "PACKAGE");
  const notes: string[] = [];

  let w = clamp(reading.width_mm, 10, 300, 0);
  let h = clamp(reading.height_mm, 10, 300, 0);
  if (!w || !h) {
    const aspect = opts.aspect && opts.aspect > 0.2 && opts.aspect < 5 ? opts.aspect : null;
    w = w || (aspect ? (aspect >= 1 ? 101.6 : 50.8) : 101.6);
    h = h || (aspect ? w / aspect : 50.8);
    notes.push("The label's size wasn't printed on it, so the size is a guess from the picture. Check the width and height, and pick your real stock size.");
  } else if (opts.aspect && Math.abs(w / h - opts.aspect) / opts.aspect > 0.2) {
    // The picture's shape is more trustworthy than a printed or estimated size that disagrees with it.
    h = w / opts.aspect;
    notes.push("The size read from the label didn't match the picture's shape, so the height was adjusted. Check the size.");
  }
  const size = snapToStock(w, h);
  const W = Math.min(300, Math.max(10, size.widthMm));
  const H = Math.min(300, Math.max(10, size.heightMm));

  const matches: ImportResult["matches"] = [];
  const unmatched = [...(reading.unmatched ?? [])].filter((s) => typeof s === "string" && s.trim()).slice(0, 30);
  const elements: LabelElement[] = [];
  let n = 0;
  for (const r of (reading.elements ?? []).slice(0, 60)) {
    const type = TYPES.includes(r.type as ElementType) ? (r.type as ElementType) : null;
    if (!type) continue;
    n++;
    const fx = clamp(r.x, 0, 0.98, 0);
    const fy = clamp(r.y, 0, 0.98, 0);
    const fw = clamp(r.w, 0.005, 1 - fx, 0.2);
    const fh = clamp(r.h, 0.005, 1 - fy, 0.1);
    const el: LabelElement = { id: `e${n}`, type, x: round(fx * W), y: round(fy * H), w: round(fw * W), h: round(fh * H) };
    if (type === "text") {
      const printed = (r.printed_text ?? r.text ?? "").slice(0, 2000);
      let text = (r.text ?? r.printed_text ?? "").slice(0, 2000);
      const c = checkPlaceholders(text, kind);
      if (c.dropped) {
        // A field this label type doesn't have: keep what was printed rather than a placeholder that would block printing.
        text = printed;
        unmatched.push(printed.slice(0, 80));
      }
      if (!text.trim()) {
        n--;
        continue;
      }
      el.text = text;
      el.bold = r.bold === true;
      el.align = r.align === "center" || r.align === "right" ? r.align : "left";
      el.fontSize = clamp(r.font_size_pt, 4, 72, 8);
      fitText(el, W, H);
      matches.push({ printed: printed.slice(0, 200), became: text.slice(0, 200), fields: c.dropped ? [] : c.fields });
    } else if (type === "barcode" || type === "qr") {
      let value = (r.value ?? "").slice(0, 500);
      const c = checkPlaceholders(value, kind);
      if (!value.trim() || c.dropped || c.fields.length === 0) {
        if (value.trim()) notes.push(`A ${type === "qr" ? "QR code" : "barcode"} held "${value.slice(0, 40)}", which isn't a CannaTrace field. It now scans to the ${DEFAULT_ID_FIELD[kind]} instead.`);
        value = `{{${DEFAULT_ID_FIELD[kind]}}}`;
      }
      el.value = value;
      if (type === "barcode") {
        el.format = (r.barcode_format === "datamatrix" ? "datamatrix" : "code128") as BarcodeFormat;
        el.h = Math.max(el.h, 6);
      }
      matches.push({ printed: type === "qr" ? "QR code" : "Barcode", became: value, fields: placeholders(value) });
    } else if (type === "image") {
      el.role = r.image_role === "STATE_LOGO" || r.image_role === "LOGO" ? r.image_role : undefined;
      matches.push({ printed: el.role === "STATE_LOGO" ? "State logo" : "Logo or picture", became: "Empty image box. Upload the logo file.", fields: [] });
    } else if (type === "line" || type === "box") {
      el.stroke = clamp(r.stroke_mm, 0.1, 5, 0.3);
      if (type === "line") {
        // A line is drawn as a thin box; keep it horizontal or vertical.
        if (el.w >= el.h) el.h = el.stroke;
        else el.w = el.stroke;
      }
    }
    // Everything must sit on the label.
    el.w = Math.min(el.w, W - el.x);
    el.h = Math.min(el.h, H - el.y);
    elements.push(el);
  }
  if (elements.length === 0) notes.push("Nothing on the picture could be read as label content. Try a sharper, straighter photo.");
  if (unmatched.length) notes.push(`${unmatched.length} printed value${unmatched.length === 1 ? "" : "s"} didn't match any CannaTrace field, so they were kept as typed text. They won't change from label to label.`);
  if (reading.notes) notes.push(String(reading.notes).slice(0, 400));

  const state = typeof reading.state === "string" && /^[A-Za-z]{2}$/.test(reading.state.trim()) ? reading.state.trim().toUpperCase() : null;
  return {
    kind,
    name: (reading.suggested_name ?? "").trim().slice(0, 80) || "Imported label",
    jurisdiction: state,
    design: { widthMm: W, heightMm: H, elements },
    matches,
    unmatched: [...new Set(unmatched)].slice(0, 30),
    notes: [...new Set(notes)],
  };
}
