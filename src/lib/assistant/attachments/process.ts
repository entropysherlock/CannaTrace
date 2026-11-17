import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { parseCsv } from "@/lib/csv";
import {
  AttachmentError,
  checkBeforeUpload,
  ext,
  LIMITS,
  mb,
  PDF_MAX_PAGES,
  IMAGE_MAX_PIXELS,
  IMAGE_SEND_EDGE,
  MAX_UNZIPPED,
  MAX_TEXT_CHARS,
  MAX_SHEETS,
  MAX_ROWS,
  MAX_COLUMNS,
  type Processed,
  type Sheet,
} from "./limits";

export { AttachmentError, checkBeforeUpload, LIMITS, readSheets, type Kind, type Processed, type Sheet } from "./limits";

/**
 * Checks and reads files attached to Tally. The type comes from the file's own bytes, never from the
 * name or the browser's word for it. Images are re-encoded (which also strips location and camera
 * metadata and defuses malformed image tricks); documents and spreadsheets are reduced to their text
 * and rows. Nothing here runs anything inside a file.
 */

/** What a file is, from its first bytes (and, for zip-based Office files and plain text, its name). */
export function sniff(bytes: Buffer, name: string): "PNG" | "JPEG" | "WEBP" | "PDF" | "ZIP" | "TEXT" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "PNG";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "WEBP";
  if (bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "PDF";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "ZIP";
  if ([".txt", ".csv"].includes(ext(name)) && !bytes.subarray(0, 8192).includes(0)) return "TEXT";
  return null;
}

async function unzipChecked(bytes: Buffer, name: string): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new AttachmentError(`${name} looks damaged and couldn't be opened.`);
  }
  // Refuse "zip bombs": small files that expand to enormous ones.
  let total = 0;
  zip.forEach((_path, entry) => {
    total += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_UNZIPPED) throw new AttachmentError(`${name} expands to more than ${mb(MAX_UNZIPPED)} when opened, so it was refused.`);
  return zip;
}

function decodeText(bytes: Buffer, name: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    try {
      // Spreadsheets saved from Excel as "CSV" are often Windows-1252.
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      throw new AttachmentError(`${name} isn't readable text.`);
    }
  }
}

async function image(bytes: Buffer, name: string): Promise<Processed> {
  if (bytes.length > LIMITS.IMAGE) throw new AttachmentError(`${name} is ${mb(bytes.length)}. Images can be up to ${mb(LIMITS.IMAGE)}.`);
  try {
    const input = sharp(bytes, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "error" });
    const info = await input.metadata();
    if (!info.width || !info.height) throw new Error("no size");
    const pipeline = input.rotate().resize({ width: IMAGE_SEND_EDGE, height: IMAGE_SEND_EDGE, fit: "inside", withoutEnlargement: true });
    const png = Boolean(info.hasAlpha) || info.format === "png";
    const { data, info: out } = await (png ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 88 })).toBuffer({ resolveWithObject: true });
    const warnings: string[] = [];
    if (Math.max(info.width, info.height) < 500) warnings.push(`The image is small (${info.width} × ${info.height} pixels), so fine print may not be readable.`);
    return {
      kind: "IMAGE",
      payload: data,
      meta: { mediaType: png ? "image/png" : "image/jpeg", width: info.width, height: info.height, sentWidth: out.width, sentHeight: out.height, warnings },
    };
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    if (/pixel limit/i.test(String((error as Error)?.message))) throw new AttachmentError(`${name} has too many pixels to process. Resize it below ${IMAGE_MAX_PIXELS / 1e6} megapixels.`);
    throw new AttachmentError(`${name} looks damaged or isn't really an image, so it couldn't be read.`);
  }
}

async function pdf(bytes: Buffer, name: string): Promise<Processed> {
  if (bytes.length > LIMITS.PDF) throw new AttachmentError(`${name} is ${mb(bytes.length)}. PDFs can be up to ${mb(LIMITS.PDF)}.`);
  let pages: number;
  try {
    pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch (error) {
    if (/encrypt/i.test(String((error as Error)?.message))) throw new AttachmentError(`${name} is password-protected. Save an unprotected copy and attach that.`);
    throw new AttachmentError(`${name} looks damaged and couldn't be opened as a PDF.`);
  }
  if (pages < 1) throw new AttachmentError(`${name} has no pages.`);
  if (pages > PDF_MAX_PAGES) throw new AttachmentError(`${name} has ${pages} pages. Tally can read up to ${PDF_MAX_PAGES} pages at once; split it and attach the part you need.`);
  return { kind: "PDF", payload: bytes, meta: { pages, warnings: [] } };
}

/** HTML from mammoth to plain text that keeps headings, lists, and table rows. */
export function htmlToText(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
  const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => entities[e]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  const inline = (frag: string) => frag.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Tables first, one line per row, so paragraphs inside cells don't break rows apart.
  const tabled = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_, body: string) => {
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => inline(c[1]).replace(/\|/g, "\\|")));
    return `\n${rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n")}\n`;
  });
  return decode(
    tabled
      .replace(/<h([1-6])[^>]*>/g, (_, n) => `\n\n${"#".repeat(Number(n))} `)
      .replace(/<\/h[1-6]>/g, "\n")
      .replace(/<li[^>]*>/g, "\n- ")
      .replace(/<(p|br)[^>]*\/?>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function docx(bytes: Buffer, name: string): Promise<Processed> {
  if (bytes.length > LIMITS.DOCX) throw new AttachmentError(`${name} is ${mb(bytes.length)}. Word files can be up to ${mb(LIMITS.DOCX)}.`);
  const zip = await unzipChecked(bytes, name);
  if (!zip.file("word/document.xml")) throw new AttachmentError(`${name} isn't a Word document (DOCX).`);
  let images = 0;
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: bytes },
      {
        convertImage: mammoth.images.imgElement(async () => {
          images++;
          return { src: "" };
        }),
      },
    );
    html = result.value;
  } catch {
    throw new AttachmentError(`${name} looks damaged and couldn't be read.`);
  }
  let text = htmlToText(html);
  const warnings: string[] = [];
  if (images) warnings.push(`The document has ${images} picture${images === 1 ? "" : "s"} (or charts) that were not read; only its text and tables were.`);
  if (!text) warnings.push("No text was found in the document.");
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters were read.`);
  }
  return { kind: "DOCUMENT", payload: Buffer.from(text, "utf8"), meta: { format: "DOCX", chars: text.length, warnings } };
}

function txt(bytes: Buffer, name: string): Processed {
  if (bytes.length > LIMITS.TXT) throw new AttachmentError(`${name} is ${mb(bytes.length)}. Text files can be up to ${mb(LIMITS.TXT)}.`);
  let text = decodeText(bytes, name);
  const warnings: string[] = [];
  if (!text.trim()) warnings.push("The file is empty.");
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters were read.`);
  }
  return { kind: "DOCUMENT", payload: Buffer.from(text, "utf8"), meta: { format: "TXT", chars: text.length, warnings } };
}

function sheetOf(name: string, table: string[][], warnings: string[]): Sheet {
  const rows = table.filter((r) => r.some((c) => c.trim() !== ""));
  const width = Math.min(Math.max(0, ...rows.map((r) => r.length)), MAX_COLUMNS);
  if (rows.some((r) => r.length > MAX_COLUMNS)) warnings.push(`Sheet "${name}" has more than ${MAX_COLUMNS} columns; only the first ${MAX_COLUMNS} were read.`);
  const header = (rows[0] ?? []).slice(0, width).map((h, i) => h.trim() || `Column ${i + 1}`);
  const body = rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  return { name, columns: header, rows: body, totalRows: body.length };
}

/** A cell's value as text, without rounding: numbers keep full precision, dates become ISO. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().endsWith("T00:00:00.000Z") ? value.toISOString().slice(0, 10) : value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in value) return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
    if ("error" in value) return String((value as ExcelJS.CellErrorValue).error);
  }
  return String(value);
}

async function xlsx(bytes: Buffer, name: string): Promise<Processed> {
  if (bytes.length > LIMITS.XLSX) throw new AttachmentError(`${name} is ${mb(bytes.length)}. Spreadsheets can be up to ${mb(LIMITS.XLSX)}.`);
  const zip = await unzipChecked(bytes, name);
  if (!zip.file("xl/workbook.xml")) throw new AttachmentError(`${name} isn't an Excel workbook (XLSX).`);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new AttachmentError(`${name} looks damaged and couldn't be read as a spreadsheet.`);
  }
  const warnings: string[] = [];
  const sheets: Sheet[] = [];
  let rowsLeft = MAX_ROWS;
  book.worksheets.slice(0, MAX_SHEETS).forEach((ws) => {
    if (ws.state !== "visible") warnings.push(`Sheet "${ws.name}" is hidden in the workbook.`);
    const table: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (table.length > rowsLeft) return;
      const values = row.values as ExcelJS.CellValue[];
      table.push(values.slice(1).map(cellText));
    });
    const sheet = sheetOf(ws.name, table, warnings);
    if (table.length > rowsLeft) warnings.push(`Only the first ${MAX_ROWS.toLocaleString("en-US")} rows of the workbook were read.`);
    rowsLeft -= sheet.rows.length;
    sheets.push(sheet);
  });
  if (book.worksheets.length > MAX_SHEETS) warnings.push(`The workbook has ${book.worksheets.length} sheets; only the first ${MAX_SHEETS} were read.`);
  if (!sheets.some((s) => s.rows.length)) warnings.push("No data rows were found.");
  return spreadsheet("XLSX", sheets, warnings);
}

function csv(bytes: Buffer, name: string): Processed {
  if (bytes.length > LIMITS.CSV) throw new AttachmentError(`${name} is ${mb(bytes.length)}. CSV files can be up to ${mb(LIMITS.CSV)}.`);
  let table: string[][];
  try {
    table = parseCsv(decodeText(bytes, name));
  } catch (error) {
    throw new AttachmentError(`${name} couldn't be read as CSV: ${(error as Error).message}`);
  }
  const warnings: string[] = [];
  if (table.length - 1 > MAX_ROWS) {
    table = table.slice(0, MAX_ROWS + 1);
    warnings.push(`Only the first ${MAX_ROWS.toLocaleString("en-US")} rows were read.`);
  }
  const sheet = sheetOf(name.replace(/\.csv$/i, ""), table, warnings);
  if (!sheet.rows.length) warnings.push("No data rows were found.");
  return spreadsheet("CSV", [sheet], warnings);
}

function spreadsheet(format: "CSV" | "XLSX", sheets: Sheet[], warnings: string[]): Processed {
  return {
    kind: "SPREADSHEET",
    payload: Buffer.from(JSON.stringify(sheets), "utf8"),
    meta: { format, sheets: sheets.map((s) => ({ name: s.name, columns: s.columns, totalRows: s.totalRows })), warnings },
  };
}

/** Check and read one uploaded file. Throws AttachmentError with a message a person can act on. */
export async function processFile(bytes: Buffer, name: string): Promise<Processed> {
  checkBeforeUpload(name, bytes.length);
  const type = sniff(bytes, name);
  const e = ext(name);
  if (type === "PNG" || type === "JPEG" || type === "WEBP") {
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(e)) throw new AttachmentError(`${name} is actually an image. Rename it with an image extension, or attach the file you meant.`);
    return image(bytes, name);
  }
  if (type === "PDF") {
    if (e !== ".pdf") throw new AttachmentError(`${name} is actually a PDF. Rename it to .pdf, or attach the file you meant.`);
    return pdf(bytes, name);
  }
  if (type === "ZIP" && e === ".docx") return docx(bytes, name);
  if (type === "ZIP" && e === ".xlsx") return xlsx(bytes, name);
  if (type === "TEXT" && e === ".csv") return csv(bytes, name);
  if (type === "TEXT" && e === ".txt") return txt(bytes, name);
  throw new AttachmentError(`${name} doesn't contain what its name says (${e.slice(1).toUpperCase()}), or it's damaged. Attach the original file.`);
}

