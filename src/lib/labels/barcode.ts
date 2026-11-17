import bwipjs from "bwip-js/generic";
import type { BarcodeFormat } from "./types";

/** A barcode turned into black rectangles, in module units (one module = the thinnest bar or one QR square). */
export type BarcodeSymbol = { kind: "linear"; modules: number; bars: { x: number; w: number }[] } | { kind: "matrix"; cols: number; rows: number; quiet: number; cells: { x: number; y: number }[] };

/** Smallest bar or square a typical 203 dpi thermal printer can print reliably, in millimetres. */
export const MIN_MODULE_MM = 0.25;
/** Blank space needed on each side of a 1D barcode so scanners can find it, in modules. */
export const QUIET_ZONE_MODULES = 10;

export class BarcodeError extends Error {}

/** Code 128 can carry printable ASCII only. */
export function code128Problem(value: string): string | null {
  if (!value) return "There is nothing to encode.";
  if (value.length > 80) return "Code 128 gets too long to scan past about 80 characters.";
  const bad = [...value].find((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126);
  if (bad) return `Code 128 cannot hold the character "${bad}". Use letters, numbers, and common punctuation only.`;
  return null;
}

export function encode(format: BarcodeFormat | "qrcode", value: string): BarcodeSymbol {
  if (format === "code128") {
    const problem = code128Problem(value);
    if (problem) throw new BarcodeError(problem);
  }
  if (!value) throw new BarcodeError("There is nothing to encode.");
  try {
    if (format === "code128") {
      const [raw] = bwipjs.raw("code128", value, {}) as unknown as { sbs: number[] }[];
      const bars: { x: number; w: number }[] = [];
      let x = 0;
      raw.sbs.forEach((w, i) => {
        if (i % 2 === 0) bars.push({ x, w });
        x += w;
      });
      return { kind: "linear", modules: x, bars };
    }
    const [raw] = bwipjs.raw(format, value, {}) as unknown as { pixs: number[]; pixx: number; pixy: number }[];
    const cells: { x: number; y: number }[] = [];
    raw.pixs.forEach((on, i) => {
      if (on) cells.push({ x: i % raw.pixx, y: Math.floor(i / raw.pixx) });
    });
    return { kind: "matrix", cols: raw.pixx, rows: raw.pixy, quiet: format === "qrcode" ? 4 : 1, cells };
  } catch (e) {
    throw new BarcodeError(e instanceof Error ? e.message.replace(/^bwip-js:\s*/, "") : "The barcode could not be made.");
  }
}

/**
 * Where to draw a symbol inside its box: 1D codes stretch to the box width after the quiet zones;
 * 2D codes stay square and centered.
 */
export function placement(sym: BarcodeSymbol, box: { x: number; y: number; w: number; h: number }) {
  if (sym.kind === "linear") {
    const total = sym.modules + QUIET_ZONE_MODULES * 2;
    const unit = box.w / total;
    return { module: unit, x0: box.x + QUIET_ZONE_MODULES * unit, y0: box.y, height: box.h };
  }
  const side = Math.min(box.w, box.h);
  const unit = side / (Math.max(sym.cols, sym.rows) + sym.quiet * 2);
  return { module: unit, x0: box.x + (box.w - unit * sym.cols) / 2, y0: box.y + (box.h - unit * sym.rows) / 2, height: side };
}
