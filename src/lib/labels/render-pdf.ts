import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { encode, placement } from "./barcode";
import { resolvedText } from "./render-svg";
import { layoutText, lineHeightMm, PT_TO_MM, textWidthMm } from "./text";
import type { LabelDesign, LabelElement, LabelRecord } from "./types";

const MM = 72 / 25.4;
const BLACK = rgb(0, 0, 0);

/** Standard PDF fonts cover Latin-1 only; anything else prints as "?" instead of failing the whole job. */
function safe(text: string): string {
  return [...text].map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 255 ? c : "?")).join("");
}

type Ctx = { page: PDFPage; heightMm: number; dx: number; dy: number; font: PDFFont; bold: PDFFont; images: Map<string, PDFImage> };

/** Draw a rectangle given in label millimetres (top-left origin). */
function rect(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.page.drawRectangle({ x: (x + ctx.dx) * MM, y: (ctx.heightMm - y - h - ctx.dy) * MM, width: w * MM, height: h * MM, color: BLACK });
}

function drawElement(ctx: Ctx, el: LabelElement, values: Record<string, string | null>) {
  switch (el.type) {
    case "text": {
      const size = el.fontSize ?? 8;
      const { lines } = layoutText(resolvedText(el, values), el.w, el.h, size, el.bold);
      const lh = lineHeightMm(size);
      lines.forEach((line, i) => {
        const width = textWidthMm(line, size, el.bold);
        const x = el.align === "center" ? el.x + (el.w - width) / 2 : el.align === "right" ? el.x + el.w - width : el.x;
        const baseline = el.y + i * lh + size * PT_TO_MM * 0.92;
        ctx.page.drawText(safe(line), { x: (x + ctx.dx) * MM, y: (ctx.heightMm - baseline - ctx.dy) * MM, size, font: el.bold ? ctx.bold : ctx.font, color: BLACK });
      });
      return;
    }
    case "barcode":
    case "qr": {
      // Validation runs before printing, so a barcode that cannot be made never reaches here.
      const sym = encode(el.type === "qr" ? "qrcode" : (el.format ?? "code128"), resolvedText(el, values));
      const p = placement(sym, el);
      if (sym.kind === "linear") {
        for (const b of sym.bars) rect(ctx, p.x0 + b.x * p.module, p.y0, b.w * p.module, p.height);
      } else {
        for (const c of sym.cells) rect(ctx, p.x0 + (c.x + sym.quiet) * p.module, p.y0 + (c.y + sym.quiet) * p.module, p.module, p.module);
      }
      return;
    }
    case "image": {
      const img = el.src ? ctx.images.get(el.src) : undefined;
      if (!img) return;
      const scale = Math.min(el.w / img.width, el.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = el.x + (el.w - w) / 2;
      const y = el.y + (el.h - h) / 2;
      ctx.page.drawImage(img, { x: (x + ctx.dx) * MM, y: (ctx.heightMm - y - h - ctx.dy) * MM, width: w * MM, height: h * MM });
      return;
    }
    case "line": {
      const s = el.stroke ?? 0.3;
      if (el.w >= el.h) rect(ctx, el.x, el.y, el.w, s);
      else rect(ctx, el.x, el.y, s, el.h);
      return;
    }
    case "box": {
      const s = el.stroke ?? 0.3;
      rect(ctx, el.x, el.y, el.w, s);
      rect(ctx, el.x, el.y + el.h - s, el.w, s);
      rect(ctx, el.x, el.y, s, el.h);
      rect(ctx, el.x + el.w - s, el.y, s, el.h);
      return;
    }
  }
}

/**
 * One PDF page per label, each page exactly the label's size, so "Actual size" printing
 * on a label printer puts one label on each sticker.
 */
export async function renderLabelsPdf(
  design: LabelDesign,
  records: LabelRecord[],
  opts: { copies?: number; offsetXMm?: number; offsetYMm?: number; title?: string } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(opts.title ?? "Leaf2Sale labels");
  doc.setCreator("Leaf2Sale SmartLabel");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const images = new Map<string, PDFImage>();
  for (const el of design.elements) {
    if (el.type !== "image" || !el.src || images.has(el.src)) continue;
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(el.src);
    if (!m) continue;
    const bytes = Buffer.from(m[2], "base64");
    images.set(el.src, m[1] === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
  }
  const copies = Math.max(1, opts.copies ?? 1);
  for (const record of records) {
    for (let c = 0; c < copies; c++) {
      const page = doc.addPage([design.widthMm * MM, design.heightMm * MM]);
      const ctx: Ctx = { page, heightMm: design.heightMm, dx: opts.offsetXMm ?? 0, dy: opts.offsetYMm ?? 0, font, bold, images };
      for (const el of design.elements) drawElement(ctx, el, record.values);
    }
  }
  return doc.save();
}
