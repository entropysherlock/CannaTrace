import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import { convert, type UnitCode } from "@/lib/units";
import { stateUnit } from "@/lib/watch/checks";
import { AttachmentError, readSheets, type Sheet } from "./attachments/process";
import { loadAttachment } from "./attachments/store";
import type { Tool } from "./tools";

/**
 * Tally's tools for attached spreadsheets. They only read: comparing a file with inventory never
 * changes inventory. Fixes go through the usual action tools and a Confirm.
 */

type Input = Record<string, unknown>;
type Row = Record<string, unknown>;
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const text = (description: string) => ({ type: "string", description });
const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const UNIT: Record<string, string> = { EACH: "ea", G: "g", KG: "kg", MG: "mg", OZ: "oz", LB: "lb", ML: "ml", L: "L" };
const qty = (v: Decimal.Value, unit: string) => `${new Decimal(v).toDecimalPlaces(4).toNumber().toLocaleString("en-US", { maximumFractionDigits: 4 })} ${UNIT[unit] ?? unit}`;
const CAP = 100;

async function pickSheet(session: Parameters<typeof loadAttachment>[0], input: Input): Promise<{ name: string; sheet: Sheet; sheets: Sheet[] }> {
  let file;
  try {
    file = await loadAttachment(session, str(input.attachment, 64));
  } catch (error) {
    if (error instanceof AttachmentError) throw new InventoryError(error.message);
    throw error;
  }
  if (file.kind !== "SPREADSHEET") throw new InventoryError(`${file.name} isn't a spreadsheet; read it directly instead.`);
  const sheets = readSheets(file.payload);
  const want = str(input.sheet);
  const sheet = want ? sheets.find((x) => x.name.toLowerCase() === want.toLowerCase()) : sheets.find((x) => x.rows.length) ?? sheets[0];
  if (!sheet) throw new InventoryError(`${file.name} has no sheet called "${want}". Its sheets: ${sheets.map((x) => x.name).join(", ")}.`);
  return { name: file.name, sheet, sheets };
}

function column(sheet: Sheet, given: string, guesses: string[], what: string, required: boolean): number {
  if (given) {
    const i = sheet.columns.findIndex((c) => c.toLowerCase() === given.toLowerCase());
    if (i < 0) throw new InventoryError(`There's no "${given}" column. The columns are: ${sheet.columns.join(", ")}.`);
    return i;
  }
  const i = sheet.columns.findIndex((c) => guesses.includes(norm(c)));
  if (i < 0 && required) throw new InventoryError(`Couldn't tell which column holds the ${what}. The columns are: ${sheet.columns.join(", ")}. Ask which one, then pass it.`);
  return i;
}

export const ATTACHMENT_TOOLS: Tool[] = [
  {
    kind: "read",
    name: "attachment_rows",
    label: "Reading the spreadsheet",
    permission: null,
    description:
      "Read rows from a spreadsheet the person attached (CSV or XLSX), beyond the preview you were shown. Optionally filter to rows where one column contains some text. Values are exactly as in the file.",
    schema: obj(
      {
        attachment: text("The attachment id from the file's label."),
        sheet: text("Sheet name; the first sheet with data if left out."),
        offset: { type: "integer", description: "Row number to start at (0 = first data row)." },
        limit: { type: "integer", description: "Up to 200. Default 100." },
        column: text("Column to filter on."),
        contains: text("Text the column must contain (case-insensitive)."),
      },
      ["attachment"],
    ),
    run: async (s, input) => {
      const { name, sheet, sheets } = await pickSheet(s, input);
      let rows = sheet.rows.map((r, i) => ({ row: i + 2, values: r }));
      if (str(input.contains)) {
        const c = column(sheet, str(input.column), [], "filter", false);
        const needle = str(input.contains).toLowerCase();
        rows = rows.filter((r) => (c >= 0 ? [r.values[c]] : r.values).some((v) => (v ?? "").toLowerCase().includes(needle)));
      }
      const offset = Math.max(0, Math.trunc(Number(input.offset) || 0));
      const limit = Math.min(Math.max(Math.trunc(Number(input.limit) || 100), 1), 200);
      return {
        file: name,
        sheet: sheet.name,
        other_sheets: sheets.filter((x) => x !== sheet).map((x) => `${x.name} (${x.totalRows} rows)`),
        columns: sheet.columns,
        matching_rows: rows.length,
        rows: rows.slice(offset, offset + limit).map((r) => ({ spreadsheet_row: r.row, ...Object.fromEntries(sheet.columns.map((c, i) => [c, r.values[i] ?? ""])) })),
        more: offset + limit < rows.length,
      };
    },
  },
  {
    kind: "read",
    name: "compare_attachment_inventory",
    label: "Comparing the file with inventory",
    permission: "inventory.view",
    description:
      "Compare an attached inventory spreadsheet (one row per package) with this facility's packages: quantity differences, packages in the file but not here, and active packages here missing from the file. Reads only; nothing changes. Finds the tag and quantity columns itself, or pass them.",
    schema: obj(
      {
        attachment: text("The attachment id."),
        sheet: text("Sheet name, if not the first with data."),
        tag_column: text("Column holding package tags."),
        quantity_column: text("Column holding quantities."),
        unit_column: text("Column holding units, if separate."),
      },
      ["attachment"],
    ),
    run: async (s, input) => {
      const { name, sheet } = await pickSheet(s, input);
      const tagCol = column(sheet, str(input.tag_column), ["tag", "packagetag", "label", "packagelabel", "packageid", "uid", "metrctag"], "package tags", true);
      const qtyCol = column(sheet, str(input.quantity_column), ["quantity", "qty", "onhand", "currentquantity", "remainingquantity", "count"], "quantities", false);
      const unitCol = column(sheet, str(input.unit_column), ["uom", "unit", "unitofmeasure", "units"], "units", false);
      const ours = (await db.execute<Row>(sql`select p.id, p.tag, p.quantity::text as quantity, p.unit, p.status, i.name as item from packages p join items i on i.id = p.item_id
        where p.org_id = ${s.orgId} and p.facility_id = ${s.facilityId}`)).rows;
      const byTag = new Map(ours.map((p) => [String(p.tag).toUpperCase(), p]));
      const seen = new Set<string>();
      const differences: Row[] = [];
      const notHere: Row[] = [];
      const unreadable: Row[] = [];
      let matched = 0;
      sheet.rows.forEach((r, i) => {
        const tag = (r[tagCol] ?? "").trim().toUpperCase();
        if (!tag) return;
        if (seen.has(tag)) {
          unreadable.push({ spreadsheet_row: i + 2, tag, problem: "This tag appears more than once in the file." });
          return;
        }
        seen.add(tag);
        const p = byTag.get(tag);
        if (!p) {
          notHere.push({ spreadsheet_row: i + 2, tag, file_quantity: qtyCol >= 0 ? r[qtyCol] : null });
          return;
        }
        if (qtyCol < 0) return void matched++;
        const raw = (r[qtyCol] ?? "").replace(/,/g, "").trim();
        const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/);
        if (!m) {
          unreadable.push({ spreadsheet_row: i + 2, tag, problem: `Quantity "${raw}" isn't a number.` });
          return;
        }
        let fileQty = new Decimal(m[1]);
        const unitText = (unitCol >= 0 ? r[unitCol] : m[2]) ?? "";
        const u = stateUnit(unitText || null);
        try {
          if (u && u !== p.unit) fileQty = convert(fileQty, u, String(p.unit) as UnitCode);
        } catch {
          unreadable.push({ spreadsheet_row: i + 2, tag, problem: `The file's unit (${unitText}) can't be compared with ${UNIT[String(p.unit)] ?? p.unit}.` });
          return;
        }
        fileQty = fileQty.toDecimalPlaces(4);
        const diff = fileQty.sub(String(p.quantity));
        if (diff.abs().lte("0.0001") && !["FINISHED", "DESTROYED"].includes(String(p.status))) return void matched++;
        differences.push({
          spreadsheet_row: i + 2,
          tag: p.tag,
          item: p.item,
          cannatrace: qty(String(p.quantity), String(p.unit)),
          file: qty(fileQty, String(p.unit)),
          difference: `${diff.gt(0) ? "+" : ""}${qty(diff, String(p.unit))} in the file`,
          cannatrace_status: String(p.status).toLowerCase(),
        });
      });
      const missingFromFile = ours
        .filter((p) => ["ACTIVE", "ALLOCATED", "ON_HOLD", "QUARANTINE"].includes(String(p.status)) && !seen.has(String(p.tag).toUpperCase()))
        .map((p) => ({ tag: p.tag, item: p.item, cannatrace: qty(String(p.quantity), String(p.unit)), status: String(p.status).toLowerCase() }));
      return {
        file: name,
        sheet: sheet.name,
        columns_used: { tag: sheet.columns[tagCol], quantity: qtyCol >= 0 ? sheet.columns[qtyCol] : "(none found: tags only)", unit: unitCol >= 0 ? sheet.columns[unitCol] : "(from the quantity, or the package's own unit)" },
        rows_in_file: sheet.totalRows,
        matching: matched,
        quantity_or_status_differences: { count: differences.length, rows: differences.slice(0, CAP) },
        in_file_not_in_cannatrace: { count: notHere.length, rows: notHere.slice(0, CAP) },
        active_here_missing_from_file: { count: missingFromFile.length, rows: missingFromFile.slice(0, CAP) },
        rows_that_could_not_be_compared: { count: unreadable.length, rows: unreadable.slice(0, CAP) },
        note: "Comparison only: nothing was changed. Which side is right needs a recount; corrections go through adjust_package or run_job with a Confirm.",
      };
    },
  },
];
