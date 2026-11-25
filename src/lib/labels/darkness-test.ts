/**
 * A test sheet for faded labels: one label per darkness step, each with solid black, small text, thin lines and a
 * barcode, so a person can see which step prints crisply. Sent as plain ZPL through Zebra Browser Print.
 * ^MD adjusts the printer's own darkness setting for that label, so each label says which step it is.
 */

export const DARKNESS_STEPS = [0, 4, 8, 12] as const;

const dots = (mm: number, dpi: number) => Math.max(1, Math.round((mm / 25.4) * dpi));

export function darknessTestZpl(o: { dpi: number; widthMm: number; heightMm: number; steps?: readonly number[] }): string {
  const { dpi } = o;
  const w = dots(o.widthMm, dpi);
  const h = dots(o.heightMm, dpi);
  const m = dots(3, dpi);
  const inner = Math.max(w - 2 * m, 1);
  const out: string[] = [];
  (o.steps ?? DARKNESS_STEPS).forEach((step, i) => {
    const label = step === 0 ? "DARKNESS +0 (as set)" : `DARKNESS +${step}`;
    out.push(
      [
        `^XA^MD${step}^PW${w}^LL${h}`,
        `^CF0,${dots(4.5, dpi)}^FO${m},${dots(3, dpi)}^FD${label}^FS`,
        `^FO${m},${dots(10, dpi)}^GB${Math.min(dots(30, dpi), inner)},${dots(5, dpi)},${dots(5, dpi)}^FS`,
        `^CF0,${dots(2.2, dpi)}^FO${m},${dots(17, dpi)}^FDSmall text: Leaf2Sale 0123456789 abcdefghij^FS`,
        `^FO${m},${dots(21.5, dpi)}^GB${inner},2,2^FS^FO${m},${dots(22.5, dpi)}^GB${inner},1,1^FS`,
        `^BY2,3,${dots(10, dpi)}^FO${m},${dots(25, dpi)}^BCN,${dots(10, dpi)},Y,N,N^FDTEST-${String(i + 1).padStart(4, "0")}^FS`,
        "^XZ",
      ].join(""),
    );
  });
  out.push("^XA^MD0^XZ"); // back to the printer's own setting
  return out.join("\n");
}
