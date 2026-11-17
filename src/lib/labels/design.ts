import type { ElementType, LabelDesign, LabelElement } from "./types";

const TYPES: ElementType[] = ["text", "barcode", "qr", "image", "line", "box"];
const MAX_ELEMENTS = 80;
const MAX_IMAGE_CHARS = 400_000;

export class DesignError extends Error {}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Turn untrusted JSON from the designer into a clean design, or explain what's wrong. */
export function parseDesign(input: unknown): LabelDesign {
  if (!input || typeof input !== "object") throw new DesignError("The design is empty.");
  const raw = input as Record<string, unknown>;
  const widthMm = num(raw.widthMm, 0, 1000, 0);
  const heightMm = num(raw.heightMm, 0, 1000, 0);
  if (widthMm < 5 || heightMm < 5 || widthMm > 300 || heightMm > 300) throw new DesignError("Label width and height must be between 5 and 300 mm.");
  if (!Array.isArray(raw.elements)) throw new DesignError("The design has no element list.");
  if (raw.elements.length > MAX_ELEMENTS) throw new DesignError(`A label can hold at most ${MAX_ELEMENTS} elements.`);
  const ids = new Set<string>();
  const elements: LabelElement[] = raw.elements.map((e, i) => {
    const r = (e ?? {}) as Record<string, unknown>;
    const type = TYPES.includes(r.type as ElementType) ? (r.type as ElementType) : null;
    if (!type) throw new DesignError(`Element ${i + 1} has an unknown type.`);
    let id = str(r.id, 40) || `e${i + 1}`;
    if (ids.has(id)) id = `${id}-${i}`;
    ids.add(id);
    const el: LabelElement = { id, type, x: num(r.x, -50, 400, 0), y: num(r.y, -50, 400, 0), w: num(r.w, 0, 400, 10), h: num(r.h, 0, 400, 5) };
    if (type === "text") {
      el.text = str(r.text, 2000) ?? "";
      el.fontSize = num(r.fontSize, 2, 72, 8);
      el.bold = r.bold === true;
      el.align = r.align === "center" || r.align === "right" ? r.align : "left";
    }
    if (type === "barcode" || type === "qr") el.value = str(r.value, 500) ?? "";
    if (type === "barcode") el.format = r.format === "datamatrix" ? "datamatrix" : "code128";
    if (type === "image") {
      const src = str(r.src, MAX_IMAGE_CHARS + 1);
      if (src && src.length > MAX_IMAGE_CHARS) throw new DesignError("An image is too large. Keep logos under about 300 KB.");
      if (src) el.src = src;
      if (r.role === "STATE_LOGO" || r.role === "LOGO") el.role = r.role;
    }
    if (type === "line" || type === "box") el.stroke = num(r.stroke, 0.1, 5, 0.3);
    return el;
  });
  return { widthMm, heightMm, elements };
}
