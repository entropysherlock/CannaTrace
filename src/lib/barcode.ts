/**
 * A product barcode as a scanner reads it. Spaces are dropped and letters made capital. A blank means "no barcode".
 * Scanners differ on leading zeros (a UPC-A is 12 digits, the same code as an EAN-13 with a 0 in front), so two
 * barcodes are the same code when they match after leading zeros are removed.
 */
export function cleanBarcode(raw: unknown, fail: (message: string) => never): string | null {
  const text = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  if (!text) return null;
  if (!/^[A-Z0-9][A-Z0-9._-]{3,47}$/.test(text)) fail(`"${text.slice(0, 48)}" isn't a barcode Leaf2Sale can use. Scan it again, or type 4 to 48 letters, digits, dashes, dots or underscores.`);
  if (!barcodeKey(text)) fail("That barcode is all zeros. Scan the product's barcode again.");
  return text;
}

/** The part of a barcode that identifies it: leading zeros removed. Empty means unusable. */
export const barcodeKey = (code: string): string => code.trim().toUpperCase().replace(/^0+/, "");
