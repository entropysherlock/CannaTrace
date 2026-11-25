import { encode, placement, BarcodeError } from "./barcode";
import { fill } from "./fields";
import { layoutText, lineHeightMm, PT_TO_MM, textWidthMm } from "./text";
import type { LabelDesign, LabelElement } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Number(v.toFixed(3));

/** The text an element will show for one record. */
export function resolvedText(el: LabelElement, values: Record<string, string | null>): string {
  return fill(el.type === "text" ? el.text : el.value, values).text;
}

function textSvg(el: LabelElement, values: Record<string, string | null>): string {
  const size = el.fontSize ?? 8;
  const { lines } = layoutText(resolvedText(el, values), el.w, el.h, size, el.bold);
  const lh = lineHeightMm(size);
  const out: string[] = [];
  lines.forEach((line, i) => {
    const width = textWidthMm(line, size, el.bold);
    const x = el.align === "center" ? el.x + (el.w - width) / 2 : el.align === "right" ? el.x + el.w - width : el.x;
    const y = el.y + i * lh + size * PT_TO_MM * 0.92;
    out.push(
      `<text x="${n(x)}" y="${n(y)}" font-family="Helvetica, Arial, sans-serif" font-size="${n(size * PT_TO_MM)}"${el.bold ? ' font-weight="700"' : ""} fill="#000">${esc(line)}</text>`,
    );
  });
  return out.join("");
}

function barcodeSvg(el: LabelElement, values: Record<string, string | null>): string {
  const value = resolvedText(el, values);
  try {
    const sym = encode(el.type === "qr" ? "qrcode" : (el.format ?? "code128"), value);
    const p = placement(sym, el);
    if (sym.kind === "linear") {
      const d = sym.bars.map((b) => `M${n(p.x0 + b.x * p.module)} ${n(p.y0)}h${n(b.w * p.module)}v${n(p.height)}h${n(-b.w * p.module)}z`).join("");
      return `<path d="${d}" fill="#000"/>`;
    }
    const m = p.module;
    const d = sym.cells.map((c) => `M${n(p.x0 + (c.x + sym.quiet) * m)} ${n(p.y0 + (c.y + sym.quiet) * m)}h${n(m)}v${n(m)}h${n(-m)}z`).join("");
    return `<path d="${d}" fill="#000"/>`;
  } catch (e) {
    const msg = e instanceof BarcodeError ? "Barcode error" : "Barcode error";
    return `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="#fde8e8" stroke="#c0392b" stroke-width="0.3" stroke-dasharray="1 0.6"/><text x="${n(el.x + 1)}" y="${n(el.y + 3)}" font-family="Helvetica, Arial, sans-serif" font-size="2.2" fill="#c0392b">${msg}</text>`;
  }
}

const SAFE_IMAGE = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/;

function elementSvg(el: LabelElement, values: Record<string, string | null>): string {
  switch (el.type) {
    case "text":
      return textSvg(el, values);
    case "barcode":
    case "qr":
      return barcodeSvg(el, values);
    case "image":
      // Only a picture stored inside the label itself is ever drawn. A web address would make every viewer's browser
      // fetch it, which tells whoever runs that address who looked at the label (APEX-21).
      return el.src && SAFE_IMAGE.test(el.src)
        ? `<image href="${esc(el.src)}" x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" preserveAspectRatio="xMidYMid meet"/>`
        : `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="none" stroke="#999" stroke-width="0.2" stroke-dasharray="1 0.6"/>`;
    case "line": {
      const s = el.stroke ?? 0.3;
      return el.w >= el.h
        ? `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(s)}" fill="#000"/>`
        : `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(s)}" height="${n(el.h)}" fill="#000"/>`;
    }
    case "box": {
      const s = el.stroke ?? 0.3;
      return `<rect x="${n(el.x + s / 2)}" y="${n(el.y + s / 2)}" width="${n(el.w - s)}" height="${n(el.h - s)}" fill="none" stroke="#000" stroke-width="${n(s)}"/>`;
    }
  }
}

/**
 * The label as an SVG drawn in millimetres. Its width and height attributes use real units,
 * so the browser shows it at actual size when the screen is calibrated.
 */
export function renderLabelSvg(design: LabelDesign, values: Record<string, string | null>, opts: { scale?: number } = {}): string {
  const w = design.widthMm;
  const h = design.heightMm;
  const size = opts.scale ? `width="${n(w * opts.scale)}" height="${n(h * opts.scale)}"` : `width="${n(w)}mm" height="${n(h)}mm"`;
  const body = design.elements.map((el) => elementSvg(el, values)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" ${size}><rect width="${n(w)}" height="${n(h)}" fill="#fff"/>${body}</svg>`;
}
