/**
 * Limits and shared types for Tally attachments. Kept free of the file-reading libraries so that
 * pages and routes that only need these don't carry them.
 */

export class AttachmentError extends Error {}

export type Kind = "IMAGE" | "PDF" | "SPREADSHEET" | "DOCUMENT";
export type Sheet = { name: string; columns: string[]; rows: string[][]; totalRows: number };
export type Processed =
  | { kind: "IMAGE"; payload: Buffer; meta: { mediaType: "image/jpeg" | "image/png"; width: number; height: number; sentWidth: number; sentHeight: number; warnings: string[] } }
  | { kind: "PDF"; payload: Buffer; meta: { pages: number; warnings: string[] } }
  | { kind: "SPREADSHEET"; payload: Buffer; meta: { format: "CSV" | "XLSX"; sheets: { name: string; columns: string[]; totalRows: number }[]; warnings: string[] } }
  | { kind: "DOCUMENT"; payload: Buffer; meta: { format: "DOCX" | "TXT"; chars: number; warnings: string[] } };

export const MB = 1024 * 1024;
/** Per-file size limits, by what the file turns out to be. */
export const LIMITS = {
  IMAGE: 15 * MB,
  PDF: 20 * MB,
  XLSX: 10 * MB,
  CSV: 10 * MB,
  DOCX: 10 * MB,
  TXT: 2 * MB,
} as const;
export const MAX_FILE_BYTES = Math.max(...Object.values(LIMITS));
export const PDF_MAX_PAGES = 100;
export const IMAGE_MAX_PIXELS = 60_000_000;
export const IMAGE_SEND_EDGE = 1568; // Claude's recommended longest edge; larger is downscaled by the API anyway
export const MAX_UNZIPPED = 150 * MB;
export const MAX_TEXT_CHARS = 200_000;
export const MAX_SHEETS = 20;
export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 200;

export const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".pdf", ".docx", ".txt", ".csv", ".xlsx"];

export const mb = (n: number) => `${Math.round((n / MB) * 10) / 10} MB`;
export const ext = (name: string) => (name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "");

/** Refuse a file before upload by its declared name and size, so nobody waits for a doomed upload. */
export function checkBeforeUpload(name: string, size: number): void {
  if (!ACCEPTED_EXTENSIONS.includes(ext(name)))
    throw new AttachmentError(`${name} isn't a file type Tally can read. Use an image (PNG, JPG, WEBP), a PDF, a Word file (DOCX), a text file (TXT), or a spreadsheet (CSV, XLSX).`);
  if (size <= 0) throw new AttachmentError(`${name} is empty.`);
  const limit = { ".png": LIMITS.IMAGE, ".jpg": LIMITS.IMAGE, ".jpeg": LIMITS.IMAGE, ".webp": LIMITS.IMAGE, ".pdf": LIMITS.PDF, ".docx": LIMITS.DOCX, ".txt": LIMITS.TXT, ".csv": LIMITS.CSV, ".xlsx": LIMITS.XLSX }[ext(name)]!;
  if (size > limit) throw new AttachmentError(`${name} is ${mb(size)}. The limit for this kind of file is ${mb(limit)}.`);
}


export function readSheets(payload: Buffer): Sheet[] {
  return JSON.parse(payload.toString("utf8")) as Sheet[];
}
