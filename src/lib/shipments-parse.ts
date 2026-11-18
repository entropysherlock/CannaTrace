import Decimal from "decimal.js";
import { findHeader, matchColumns, num } from "./importers/dutchie-parse";

/**
 * Receiving a shipment against its manifest: the seller's list of packages (tag, product, quantity).
 * Pure functions, no database: read the manifest, then compare it with what actually arrived.
 * Columns are matched loosely, the same way as inventory imports (Package ID / Tag, Product Name, Quantity…).
 */

export type ManifestLine = {
  line: number;
  tag: string;
  product: string;
  sku: string | null;
  quantity: string;
  lot: string | null;
  cost: string | null;
};

export function parseManifest(table: string[][]): { lines: ManifestLine[]; problems: string[] } {
  const at = findHeader(table, "dutchie");
  if (at < 0) return { lines: [], problems: ["This doesn't look like a manifest: no row names columns like Package ID, Product Name, and Quantity."] };
  const header = table[at];
  const cols = matchColumns(header, "dutchie");
  const problems: string[] = [];
  const tagCol = cols.externalTag ?? cols.tag;
  if (tagCol === undefined) problems.push("The manifest has no Package ID or tag column. Every package on a manifest has a tag.");
  if (cols.quantity === undefined) problems.push("The manifest has no Quantity column.");
  if (cols.product === undefined && cols.sku === undefined) problems.push("The manifest has no Product Name or SKU column.");
  if (problems.length) return { lines: [], problems };

  const get = (cells: string[], i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());
  const lines: ManifestLine[] = [];
  const seen = new Set<string>();
  table.slice(at + 1).forEach((cells, i) => {
    const line = at + i + 2;
    if (!cells.some((c) => c.trim())) return;
    const tag = get(cells, tagCol).replace(/\s+/g, "").toUpperCase();
    const product = get(cells, cols.product) || get(cells, cols.sku);
    if (!tag) return void problems.push(`Line ${line}: there's no package tag.`);
    if (/^\d+(\.\d+)?E\+?\d+$/.test(tag)) return void problems.push(`Line ${line}: the tag ${tag} was shortened by Excel. Format the column as Text and save again.`);
    if (seen.has(tag)) return void problems.push(`Line ${line}: tag ${tag} is on the manifest twice.`);
    seen.add(tag);
    const quantity = num(get(cells, cols.quantity));
    if (!quantity || quantity.lte(0)) return void problems.push(`Line ${line} (${tag}): the quantity must be a number above zero.`);
    lines.push({
      line,
      tag,
      product: product.slice(0, 120),
      sku: get(cells, cols.sku) || null,
      quantity: quantity.toString(),
      lot: get(cells, cols.batch) || null,
      cost: num(get(cells, cols.cost))?.toString() ?? null,
    });
  });
  if (!lines.length && !problems.length) problems.push("The manifest has no packages on it.");
  return { lines, problems };
}

/** What arrived for one manifest line, as the receiver counted it, and why when it's less than expected. */
export type Received = { quantity: string; reason?: string };

export type LineStatus = "MATCH" | "SHORT" | "MISSING";

export type ReviewLine = ManifestLine & { received: string; status: LineStatus; reason: string | null };

/**
 * Compare the manifest with what arrived. Anything not entered is taken as arriving exactly as listed.
 * More than the manifest can't be accepted (the state only allows what's on it). Short or missing lines
 * each need a reason, because they're recorded with the state as rejected or short.
 */
export function reviewShipment(lines: ManifestLine[], received: Record<string, Received>): { lines: ReviewLine[]; problems: string[] } {
  const problems: string[] = [];
  const out: ReviewLine[] = [];
  for (const l of lines) {
    const entry = received[l.tag];
    const text = (entry?.quantity ?? l.quantity).toString().trim();
    let got: Decimal;
    try {
      got = new Decimal(text === "" ? "0" : text);
      if (!got.isFinite() || got.lt(0)) throw new Error();
    } catch {
      problems.push(`${l.tag}: "${text}" isn't a quantity.`);
      continue;
    }
    const expected = new Decimal(l.quantity);
    if (got.gt(expected)) {
      problems.push(`${l.tag}: ${got} arrived but the manifest lists ${expected}. Only what's on the manifest can be received; ask the seller to correct it.`);
      continue;
    }
    const status: LineStatus = got.isZero() ? "MISSING" : got.lt(expected) ? "SHORT" : "MATCH";
    const reason = (entry?.reason ?? "").trim().slice(0, 200) || null;
    if (status !== "MATCH" && !reason) problems.push(`${l.tag}: ${status === "MISSING" ? "didn't arrive" : `${got} of ${expected} arrived`}. Say why (for example damaged, short-shipped, refused).`);
    out.push({ ...l, received: got.toString(), status, reason: status === "MATCH" ? null : reason });
  }
  return { lines: out, problems };
}
