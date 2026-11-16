import { InventoryError } from "./inventory-math";

export const MAX_IMPORT_ROWS = 2000;

/** Parse CSV text (RFC 4180: quoted fields, doubled quotes, commas and new lines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const input = text.replace(/^﻿/, "");
  while (i < input.length) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (c === "\r" && input[i + 1] === "\n") i += 1;
    } else {
      field += c;
    }
    i += 1;
  }
  if (quoted) throw new InventoryError("The file has a quote mark that is never closed. Check the row where the text runs on.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Turn CSV text into records keyed by header, checking the required columns are present.
 * Headers are matched without regard to case, spaces, or underscores.
 */
export function readTable(text: string, required: string[], optional: string[] = []): { line: number; values: Record<string, string> }[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new InventoryError("The file is empty.");
  const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const header = rows[0].map(norm);
  const missing = required.filter((name) => !header.includes(norm(name)));
  if (missing.length) {
    throw new InventoryError(`The first row must name the columns. Missing: ${missing.join(", ")}. Download the template to see the layout.`);
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new InventoryError(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  const wanted = [...required, ...optional];
  return rows.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    for (const name of wanted) {
      const at = header.indexOf(norm(name));
      values[name] = at >= 0 ? (cells[at] ?? "").trim() : "";
    }
    return { line: index + 2, values };
  });
}

/** One CSV cell. Text that a spreadsheet would run as a formula is made safe with a leading apostrophe. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  const numeric = /^-?\d+(\.\d+)?$/.test(text);
  if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
