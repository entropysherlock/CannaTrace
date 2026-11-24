/**
 * Turning a drawn label into ZPL, the language Zebra printers speak. The label is drawn as a picture at the
 * printer's own resolution and sent as a one-colour image, so what prints is exactly what the preview and
 * PDF show (text, barcodes, QR codes, lines). Runs in the browser; the pure parts have no browser calls.
 */

export type ZplOptions = {
  /** Printer resolution, dots per inch. */
  dpi: number;
  widthMm: number;
  heightMm: number;
  /** Shift the picture on the label; positive is right and down. Pixels pushed off an edge are cut. */
  offsetXMm?: number;
  offsetYMm?: number;
  /** How many of each label. */
  copies?: number;
};

export const dotsFor = (mm: number, dpi: number) => Math.max(1, Math.round((mm / 25.4) * dpi));

/**
 * One label's ZPL from a grid of dark/light pixels (1 = black). The grid must be the label's full size in dots.
 * Each row is padded to whole bytes, as ^GF expects.
 */
export function zplFromBitmap(dark: Uint8Array, width: number, height: number, copies = 1): string {
  if (dark.length !== width * height) throw new Error("The label picture has the wrong size.");
  const rowBytes = Math.ceil(width / 8);
  const hex: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let b = 0; b < rowBytes; b++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit;
        if (x < width && dark[y * width + x]) byte |= 0x80 >> bit;
      }
      row += byte.toString(16).toUpperCase().padStart(2, "0");
    }
    hex.push(row);
  }
  const total = rowBytes * height;
  const n = Math.min(Math.max(Math.trunc(copies), 1), 50);
  return `^XA^PW${width}^LL${height}^LH0,0^FO0,0^GFA,${total},${total},${rowBytes},${hex.join("")}^FS^PQ${n},0,1,N^XZ`;
}

/** Dark/light from RGBA pixels: anything darker than mid-grey, and not see-through, prints black. */
export function darkPixels(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i] = a > 127 && luminance < 140 ? 1 : 0;
  }
  return out;
}

/** Draw one label's SVG at the printer's resolution and turn it into ZPL. Browser only. */
export async function labelSvgToZpl(svg: string, o: ZplOptions): Promise<string> {
  const width = dotsFor(o.widthMm, o.dpi);
  const height = dotsFor(o.heightMm, o.dpi);
  const shiftX = Math.round(((o.offsetXMm ?? 0) / 25.4) * o.dpi);
  const shiftY = Math.round(((o.offsetYMm ?? 0) / 25.4) * o.dpi);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The label couldn't be drawn for the printer."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't draw labels for the printer.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, shiftX, shiftY, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return zplFromBitmap(darkPixels(data, width, height), width, height, o.copies ?? 1);
}
