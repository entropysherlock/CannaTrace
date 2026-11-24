/**
 * Text measurement shared by the on-screen preview and the PDF, so both wrap lines the same way.
 * Widths are Helvetica's published character widths in thousandths of an em.
 */
const NARROW = new Set([..."il.,:;'|!I[]()`"]);
const SEMI = new Set([..."fjrt-/ "]);
const WIDE = new Set([..."mwMW@%"]);
const CAPS = /[A-Z]/;

function charWidth(ch: string): number {
  if (NARROW.has(ch)) return 0.25;
  if (SEMI.has(ch)) return 0.3;
  if (WIDE.has(ch)) return 0.86;
  if (CAPS.test(ch)) return 0.68;
  return 0.556;
}

export const PT_TO_MM = 25.4 / 72;

/** Width of a line of text in millimetres. */
export function textWidthMm(text: string, fontSizePt: number, bold = false): number {
  let em = 0;
  for (const ch of text) em += charWidth(ch);
  return em * fontSizePt * PT_TO_MM * (bold ? 1.06 : 1);
}

export function lineHeightMm(fontSizePt: number): number {
  return fontSizePt * PT_TO_MM * 1.2;
}

/** Break text into lines that fit a width. Explicit newlines are kept. Words longer than a line are split. */
export function wrapText(text: string, widthMm: number, fontSizePt: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidthMm(candidate, fontSizePt, bold) <= widthMm) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the box gets broken by character.
      let rest = word;
      while (textWidthMm(rest, fontSizePt, bold) > widthMm && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidthMm(rest.slice(0, cut), fontSizePt, bold) > widthMm) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** How many wrapped lines fit in a box, and whether any text is cut off. */
export function layoutText(text: string, widthMm: number, heightMm: number, fontSizePt: number, bold = false) {
  const lines = wrapText(text, widthMm, fontSizePt, bold);
  const fits = Math.max(1, Math.floor(heightMm / lineHeightMm(fontSizePt) + 0.001));
  return { lines: lines.slice(0, fits), overflow: lines.length > fits, totalLines: lines.length };
}

/** Make a text element's words fit its box: shrink the type a little, then grow the box downward. Mutates the element. */
export function fitText(el: { text?: string; fontSize?: number; bold?: boolean; w: number; h: number; y: number }, labelW: number, labelH: number): void {
  void labelW;
  let size = el.fontSize ?? 8;
  const text = el.text ?? "";
  // A pattern like {{field}} prints shorter or longer than its name; measure it as a typical value of similar length.
  const measured = text.replace(/\{\{[^}]*\}\}/g, "XXXXXXXXXX");
  while (size > 4.5 && layoutText(measured, el.w, el.h, size, el.bold).overflow) size = Math.round((size - 0.5) * 10) / 10;
  el.fontSize = size;
  if (layoutText(measured, el.w, el.h, size, el.bold).overflow) {
    const needed = wrapText(measured, el.w, size, el.bold).length * lineHeightMm(size);
    el.h = Math.min(Math.round(needed * 100) / 100 + 0.5, Math.max(el.h, labelH - el.y));
  }
}
