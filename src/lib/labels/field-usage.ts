import { fieldDef, placeholders } from "./fields";
import type { LabelDesign, LabelElement, LabelKind } from "./types";
import { fieldsFor } from "./fields";

/** The text a piece prints: its words, or the data a barcode or QR code holds. */
export const elementSource = (el: LabelElement): string | undefined => (el.type === "text" ? el.text : el.type === "barcode" || el.type === "qr" ? el.value : undefined);

/** Every field the design pulls from the record, in label order, with the pieces that use it. */
export function fieldsUsed(design: LabelDesign): { key: string; label: string; elementIds: string[] }[] {
  const out = new Map<string, { key: string; label: string; elementIds: string[] }>();
  for (const el of [...design.elements].sort((a, b) => a.y - b.y || a.x - b.x)) {
    for (const key of placeholders(elementSource(el))) {
      const entry = out.get(key) ?? { key, label: fieldDef(key)?.label ?? key, elementIds: [] };
      if (!entry.elementIds.includes(el.id)) entry.elementIds.push(el.id);
      out.set(key, entry);
    }
  }
  return [...out.values()];
}

/** Show each field by its name, like [Lot number], so it is plain which parts of a label change per package. */
export function fieldNameValues(kind: LabelKind): Record<string, string> {
  return Object.fromEntries(fieldsFor(kind).map((f) => [f.key, `[${f.label}]`]));
}

/** Add a field to a piece's text: after a space when there are already words. */
export function withField(current: string | undefined, key: string): string {
  const text = current ?? "";
  return `${text}${text && !/\s$/.test(text) ? " " : ""}{{${key}}}`;
}

/** Take one field out of a piece's text, tidying the space it leaves. */
export function withoutField(current: string | undefined, key: string): string {
  return (current ?? "").replace(new RegExp(`\\s*\\{\\{\\s*${key.replace(/\./g, "\\.")}\\s*\\}\\}`, "g"), "").replace(/^\s+/, "");
}
