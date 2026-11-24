import { encode, placement, MIN_MODULE_MM } from "./barcode";
import { fill, sampleValues } from "./fields";
import { layoutText, lineHeightMm, wrapText } from "./text";
import type { LabelDesign, LabelElement, LabelKind } from "./types";

/**
 * Tidy a rebuilt label into clean rows. A photo gives rough positions, so pieces overlap and drift. This keeps the
 * reading order and what sits side by side, and lays everything out again: even margins, no overlaps, text sized to fit,
 * barcodes wide enough to print. Pure and deterministic.
 */

const MARGIN = 3;
const GAP_X = 2;
const GAP_Y = 1.2;
const MIN_FONT = 5;

type Item = { el: LabelElement; top: number; bottom: number; left: number };

/** Group similar font sizes so the label uses a few sizes instead of a dozen near-misses. */
function cleanFonts(elements: LabelElement[]): void {
  const sizes = [...new Set(elements.filter((e) => e.type === "text").map((e) => e.fontSize ?? 8))].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const s of sizes) {
    const last = groups[groups.length - 1];
    if (last && s - last[last.length - 1] <= 1) last.push(s);
    else groups.push([s]);
  }
  const map = new Map<number, number>();
  for (const g of groups) {
    const pick = Math.round(g[g.length - 1] * 2) / 2; // use the larger so nothing gets harder to read
    for (const s of g) map.set(s, Math.max(MIN_FONT, pick));
  }
  for (const e of elements) if (e.type === "text") e.fontSize = map.get(e.fontSize ?? 8) ?? Math.max(MIN_FONT, e.fontSize ?? 8);
}

function textHeight(text: string, w: number, size: number, bold: boolean, kind: LabelKind): number {
  // Measure with typical values so a short placeholder doesn't make a box too small for a real one.
  const measured = fill(text, sampleValues(kind)).text.replace(/\{\{[^}]*\}\}/g, "XXXXXXXX");
  return Math.max(wrapText(measured, w, size, bold).length, 1) * lineHeightMm(size) + 0.6;
}

/** The narrowest width a barcode can have and still print cleanly, for typical data. */
function barcodeMinWidth(el: LabelElement, kind: LabelKind): number {
  try {
    const value = fill(el.value, sampleValues(kind)).text || "CT-000007";
    const probe = 100;
    const unit = placement(encode(el.format === "datamatrix" ? "datamatrix" : "code128", value), { x: 0, y: 0, w: probe, h: el.h }).module;
    return Math.ceil((probe * MIN_MODULE_MM) / unit) + 1;
  } catch {
    return 40;
  }
}

export function tidyDesign(design: LabelDesign, kind: LabelKind): { design: LabelDesign; changed: boolean } {
  const W = design.widthMm;
  const inner = W - MARGIN * 2;
  const source = design.elements.filter((e) => e.type === "text" || e.type === "barcode" || e.type === "qr" || e.type === "image");
  const lines = design.elements.filter((e) => e.type === "line" && e.w >= e.h);
  if (source.length === 0) return { design, changed: false };
  const els = source.map((e) => ({ ...e }));
  cleanFonts(els);
  for (const e of els) if (kind === "PRODUCT" && e.type === "text" && /\{\{\s*item\.name\s*\}\}/.test(e.text ?? "")) e.bold = true;

  // Rows: pieces whose vertical middles fall inside the same band sit side by side.
  const items: Item[] = els.map((el) => ({ el, top: el.y, bottom: el.y + el.h, left: el.x })).sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: Item[][] = [];
  let band: { top: number; bottom: number } | null = null;
  for (const it of items) {
    const mid = (it.top + it.bottom) / 2;
    if (band && rows.length && mid >= band.top && mid <= band.bottom && it.el.type !== "barcode") {
      rows[rows.length - 1].push(it);
      band = { top: Math.min(band.top, it.top), bottom: Math.max(band.bottom, it.bottom) };
    } else {
      rows.push([it]);
      band = { top: it.top, bottom: it.bottom };
    }
  }
  // A barcode always gets a row of its own, so it can be as wide as it needs.
  const split: Item[][] = [];
  for (const r of rows) {
    const bars = r.filter((i) => i.el.type === "barcode");
    const rest = r.filter((i) => i.el.type !== "barcode");
    if (bars.length && rest.length) {
      const before = rest.filter((i) => i.top < Math.min(...bars.map((b) => b.top)));
      const after = rest.filter((i) => !before.includes(i));
      if (before.length) split.push(before);
      for (const b of bars) split.push([b]);
      if (after.length) split.push(after);
    } else split.push(r);
  }

  const out: LabelElement[] = [];
  let y = MARGIN;
  let n = 0;
  const id = () => `e${++n}`;
  let lineIdx = 0;
  const sortedLines = lines.sort((a, b) => a.y - b.y);

  for (const row of split) {
    // A separator line that sat above this row stays above it.
    const rowTop = Math.min(...row.map((r) => r.top));
    while (lineIdx < sortedLines.length && sortedLines[lineIdx].y <= rowTop) {
      out.push({ id: id(), type: "line", x: MARGIN, y, w: inner, h: sortedLines[lineIdx].stroke ?? 0.3, stroke: sortedLines[lineIdx].stroke ?? 0.3 });
      y += (sortedLines[lineIdx].stroke ?? 0.3) + GAP_Y;
      lineIdx++;
    }
    row.sort((a, b) => a.left - b.left);
    // Fixed-size pieces first, then text shares what's left in proportion to how wide it was.
    const fixed = new Map<Item, number>();
    for (const it of row) {
      const e = it.el;
      if (e.type === "qr") fixed.set(it, Math.min(26, Math.max(16, Math.min(e.w, e.h))));
      else if (e.type === "image") fixed.set(it, e.role === "STATE_LOGO" ? 13 : Math.min(20, Math.max(10, Math.min(e.w, e.h))));
      else if (e.type === "barcode") fixed.set(it, row.length === 1 ? inner : Math.min(inner, Math.max(e.w, barcodeMinWidth(e, kind))));
    }
    const fixedTotal = [...fixed.values()].reduce((a, b) => a + b, 0);
    const gaps = (row.length - 1) * GAP_X;
    const texts = row.filter((i) => !fixed.has(i));
    const free = Math.max(inner - fixedTotal - gaps, 8);
    const weight = texts.reduce((a, i) => a + Math.max(i.el.w, 4), 0) || 1;
    let x = MARGIN;
    let rowH = 0;
    const placed: LabelElement[] = [];
    for (const it of row) {
      const e = { ...it.el, id: id() };
      e.x = Math.round(x * 100) / 100;
      e.y = y;
      if (e.type === "text") {
        e.w = Math.round(((free * Math.max(it.el.w, 4)) / weight) * 100) / 100;
        const size = e.fontSize ?? 8;
        e.h = Math.round(textHeight(e.text ?? "", e.w, size, Boolean(e.bold), kind) * 100) / 100;
      } else if (e.type === "barcode") {
        e.w = Math.round(fixed.get(it)! * 100) / 100;
        e.h = Math.round(Math.min(18, Math.max(8, it.el.h)) * 100) / 100;
      } else {
        const s = fixed.get(it)!;
        e.w = s;
        e.h = s;
      }
      x += e.w + GAP_X;
      rowH = Math.max(rowH, e.h);
      placed.push(e);
    }
    // Keep row neighbours level: a short piece sits at the top of the row.
    out.push(...placed);
    y += rowH + GAP_Y;
  }
  while (lineIdx < sortedLines.length) lineIdx++;

  const height = Math.max(Math.ceil((y - GAP_Y + MARGIN) * 10) / 10, design.heightMm);
  const result: LabelDesign = { widthMm: W, heightMm: Math.min(height, 300), elements: out };
  // Squeeze: if even 300 mm isn't enough, shrink text a little and try once more.
  if (height > 300) {
    for (const e of result.elements) if (e.type === "text") e.fontSize = Math.max(MIN_FONT, (e.fontSize ?? 8) - 1);
  }
  // Anything still cut off after layout gets a taller box.
  for (const e of result.elements) {
    if (e.type !== "text") continue;
    const fit = layoutText(fill(e.text, sampleValues(kind)).text.replace(/\{\{[^}]*\}\}/g, "XXXXXXXX"), e.w, e.h, e.fontSize ?? 8, e.bold);
    if (fit.overflow) e.h = Math.min(e.h + lineHeightMm(e.fontSize ?? 8) * 2, result.heightMm - e.y);
  }
  return { design: result, changed: true };
}
