import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { orders, packages, plantBatches, plants } from "@/db/schema";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import { encode, MIN_MODULE_MM, placement, QUIET_ZONE_MODULES } from "@/lib/labels/barcode";
import { LabelDataError, loadLabelRecords } from "@/lib/labels/data";
import { fill } from "@/lib/labels/fields";
import { createPrintJob, defaultTemplateId, getTemplate, LabelError, listTemplates, previewLabels } from "@/lib/labels/service";
import type { LabelIssue, LabelKind } from "@/lib/labels/types";
import type { Session } from "@/lib/session";
import type { Tool } from "./tools";

/**
 * Tally's label tools. Every number comes from the deterministic label checker, never
 * from the model. Printing goes through a proposal the person confirms, and only creates a
 * print job: inventory is never changed.
 */

type Input = Record<string, unknown>;
const KINDS: LabelKind[] = ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"];
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const text = (description: string) => ({ type: "string", description });

/** Turn label-engine errors into the assistant's error type, so the model sees a plain message. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LabelError) {
      const blocks = e.issues.filter((i) => i.severity === "block").slice(0, 6).map((i) => i.message);
      throw new InventoryError(blocks.length ? `${e.message} ${blocks.join(" ")}` : e.message);
    }
    if (e instanceof LabelDataError) throw new InventoryError(e.message);
    throw e;
  }
}

function kindOf(v: unknown): LabelKind {
  const k = str(v).toUpperCase() as LabelKind;
  if (!KINDS.includes(k)) throw new InventoryError(`Label type must be one of ${KINDS.join(", ")}.`);
  return k;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

/** Find record ids from what a person typed: tags, batch names, or order numbers. Or every active package, or today's new ones. */
async function resolveRecords(s: Session, kind: LabelKind, input: Input): Promise<{ ids: string[]; how: string }> {
  const refs = Array.isArray(input.refs) ? input.refs.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 1000) : [];
  const scope = { org: s.orgId, fac: s.facilityId };
  if (refs.length) {
    let found: { id: string; ref: string }[] = [];
    if (kind === "PACKAGE" || kind === "PRODUCT")
      found = (await db.select({ id: packages.id, ref: packages.tag }).from(packages).where(and(eq(packages.orgId, scope.org), eq(packages.facilityId, scope.fac), inArray(packages.tag, refs))));
    else if (kind === "PLANT") found = await db.select({ id: plants.id, ref: plants.tag }).from(plants).where(and(eq(plants.orgId, scope.org), eq(plants.facilityId, scope.fac), inArray(plants.tag, refs)));
    else if (kind === "BATCH")
      found = await db.select({ id: plantBatches.id, ref: plantBatches.name }).from(plantBatches).where(and(eq(plantBatches.orgId, scope.org), eq(plantBatches.facilityId, scope.fac), inArray(plantBatches.name, refs)));
    else {
      // People say "order 1042"; order numbers are stored as SO-01042.
      const wanted = refs.map((r) => (/^\d+$/.test(r) ? `SO-${r.padStart(5, "0")}` : r.toUpperCase()));
      found = await db.select({ id: orders.id, ref: orders.number }).from(orders).where(and(eq(orders.orgId, scope.org), eq(orders.facilityId, scope.fac), inArray(orders.number, wanted)));
      const missing = wanted.filter((w) => !found.some((f) => f.ref === w));
      if (missing.length) throw new InventoryError(`Not found at this facility: ${missing.slice(0, 10).join(", ")}.`);
      return { ids: found.map((f) => f.id), how: found.map((f) => f.ref).join(", ") };
    }
    const missing = refs.filter((r) => !found.some((f) => f.ref === r));
    if (missing.length) throw new InventoryError(`Not found at this facility: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}.`);
    return { ids: found.map((f) => f.id), how: `${found.length} named record${found.length === 1 ? "" : "s"}` };
  }
  if ((kind === "PACKAGE" || kind === "PRODUCT") && (input.created_today === true || input.all_active === true)) {
    const where = [eq(packages.orgId, scope.org), eq(packages.facilityId, scope.fac), inArray(packages.status, ["ACTIVE", "ALLOCATED"])];
    if (input.created_today === true) where.push(gte(packages.createdAt, sql`(${today()}::date)::timestamp at time zone 'America/Denver'`));
    const rows = await db.select({ id: packages.id }).from(packages).where(and(...where)).limit(1000);
    if (!rows.length) throw new InventoryError(input.created_today === true ? "No active packages were created at this facility today." : "There are no active packages at this facility.");
    return { ids: rows.map((r) => r.id), how: input.created_today === true ? `packages created today (${today()})` : "all active packages" };
  }
  if (kind === "PLANT" && input.all_active === true) {
    const rows = await db.select({ id: plants.id }).from(plants).where(and(eq(plants.orgId, scope.org), eq(plants.facilityId, scope.fac), eq(plants.status, "ACTIVE"))).limit(1000);
    if (!rows.length) throw new InventoryError("There are no active plants at this facility.");
    return { ids: rows.map((r) => r.id), how: "all active plants" };
  }
  throw new InventoryError("Say which records: give tags, batch names, or order numbers, or ask for today's packages or all active packages.");
}

export async function templateFor(s: Session, kind: LabelKind, name: string): Promise<string> {
  if (name) {
    const list = (await listTemplates(s)).filter((t) => t.kind === kind && t.name.toLowerCase().includes(name.toLowerCase()));
    if (!list.length) throw new InventoryError(`No ${kind.toLowerCase()} template matches "${name}".`);
    if (list.length > 1 && !list.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new InventoryError(`Several templates match "${name}": ${list.map((t) => t.name).join(", ")}. Ask which one.`);
    return (list.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? list[0]).id;
  }
  const id = await defaultTemplateId(s, kind);
  if (!id) throw new InventoryError(`There's no ${kind.toLowerCase()} label template at this facility. A manager can make one in SmartLabel AI → Templates.`);
  return id;
}

/** Collapse repeated issues so 200 labels with the same gap read as one line with a count. */
function summarize(issues: LabelIssue[]) {
  const map = new Map<string, { severity: string; category: string; message: string; fix?: string; citation?: string; labels: number; examples: string[] }>();
  for (const i of issues) {
    const message = i.recordRef ? i.message.replace(`${i.recordRef}: `, "").replace(`${i.recordRef} `, "This record ") : i.message;
    const key = `${i.code}|${message}`;
    const hit = map.get(key) ?? { severity: i.severity, category: i.category, message, fix: i.fix, citation: i.citation, labels: 0, examples: [] };
    hit.labels++;
    if (i.recordRef && hit.examples.length < 5) hit.examples.push(i.recordRef);
    map.set(key, hit);
  }
  const order = { block: 0, warn: 1, info: 2 } as Record<string, number>;
  return [...map.values()].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 25);
}

export const LABEL_TOOLS: Tool[] = [
  {
    kind: "read",
    name: "label_templates",
    label: "Looking at label templates",
    permission: "labels.print",
    description: "List this facility's label templates: type, size, version, default, and which state's label rules each is checked against.",
    schema: obj({}),
    run: async (s) =>
      guard(async () =>
        (await listTemplates(s)).map((t) => ({
          name: t.name,
          type: t.kind,
          size_mm: `${t.design.widthMm} x ${t.design.heightMm}`,
          version: t.currentVersion,
          default: t.isDefault,
          state_rules: t.jurisdiction ?? "none (internal label)",
        })),
      ),
  },
  {
    kind: "read",
    name: "label_check",
    label: "Checking labels",
    permission: "labels.print",
    description:
      "Run SmartLabel's checker on real records without printing. Finds missing data, data that contradicts itself (failed or missing lab tests, held packages), barcodes that won't print or scan, text that won't fit, and gaps against verified state label rules. Use for 'find labels missing required information' and before preparing any print. Report its findings; never add requirements it doesn't list.",
    schema: obj(
      {
        label_type: { type: "string", enum: KINDS },
        refs: { type: "array", items: { type: "string" }, description: "Package or plant tags, batch names, or order numbers." },
        created_today: { type: "boolean", description: "Packages created at this facility today." },
        all_active: { type: "boolean", description: "Every active package (or plant)." },
        template: text("Template name. Leave out to use the facility default for the label type."),
      },
      ["label_type"],
    ),
    run: async (s, input) =>
      guard(async () => {
        const kind = kindOf(input.label_type);
        const { ids, how } = await resolveRecords(s, kind, input);
        const templateId = await templateFor(s, kind, str(input.template));
        const p = await previewLabels(s, templateId, ids);
        return {
          template: `${p.template.name} v${p.version}`,
          records: how,
          labels: p.records.length,
          can_print: !p.blocked,
          blocking: p.issues.filter((i) => i.severity === "block").length,
          warnings: p.issues.filter((i) => i.severity === "warn").length,
          state_rules: p.pack ? { source: p.pack.source, url: p.pack.url, checked_automatically: p.checkedRules, need_a_person: p.manualRules } : "No verified state label rules applied to this label.",
          findings: summarize(p.issues),
          note: "These checks catch mistakes; passing them does not certify a label as compliant.",
        };
      }),
  },
  {
    kind: "read",
    name: "barcode_diagnose",
    label: "Checking the barcode",
    permission: "labels.print",
    description:
      "Explain why a label's barcode may not scan: measures the thinnest bar or square in millimetres, size, quiet zone, and whether the data can be encoded, for a template (and optionally a real record's data). Combine with printer advice (100% scale, correct paper size, darkness, scanner symbology).",
    schema: obj({ label_type: { type: "string", enum: KINDS }, template: text("Template name; default template if left out."), ref: text("Optional tag, batch name, or order number to test with real data.") }, ["label_type"]),
    run: async (s, input) =>
      guard(async () => {
        const kind = kindOf(input.label_type);
        const t = await getTemplate(s, await templateFor(s, kind, str(input.template)));
        let values: Record<string, string | null> | null = null;
        let ref = "sample data";
        if (str(input.ref)) {
          const { ids } = await resolveRecords(s, kind, { refs: [str(input.ref)] });
          const [rec] = await loadLabelRecords(s, kind, ids);
          values = rec.values;
          ref = rec.ref;
        }
        const codes = t.design.elements.filter((e) => e.type === "barcode" || e.type === "qr");
        if (!codes.length) return { template: t.template.name, result: "This template has no barcode or QR code." };
        return {
          template: `${t.template.name} v${t.version}`,
          tested_with: ref,
          printer_minimum_mm: MIN_MODULE_MM,
          codes: codes.map((el) => {
            const format = el.type === "qr" ? "QR code" : el.format === "datamatrix" ? "Data Matrix" : "Code 128";
            const data = values ? fill(el.value, values).text : el.value;
            try {
              const sym = encode(el.type === "qr" ? "qrcode" : (el.format ?? "code128"), data ?? "");
              const p = placement(sym, el);
              return {
                format,
                encodes: values ? data : el.value,
                box_mm: `${el.w} x ${el.h}`,
                thinnest_bar_mm: Number(p.module.toFixed(3)),
                quiet_zone: sym.kind === "linear" ? `${QUIET_ZONE_MODULES} modules each side, included in the box` : `${sym.quiet} modules, included`,
                verdict: p.module < 0.19 ? "Too dense to print: will not scan." : p.module < MIN_MODULE_MM ? "Tight: a 203 dpi printer may blur the bars." : el.type === "barcode" && el.h < 5 ? "Bars are short; handheld scanners may miss it." : "Size is fine for a 203 dpi printer.",
              };
            } catch (e) {
              return { format, encodes: data, verdict: `Can't be made: ${(e as Error).message}` };
            }
          }),
        };
      }),
  },
  {
    kind: "action",
    name: "prepare_labels",
    label: "Preparing labels",
    permission: "labels.print",
    description:
      "Propose a print job after the checker passes. Only creates a print job the person then opens as a PDF; it never changes inventory. If the person gave a number of labels, pass it as expected_labels so a mismatch is caught. Nothing happens until they press Confirm.",
    schema: obj(
      {
        label_type: { type: "string", enum: KINDS },
        refs: { type: "array", items: { type: "string" }, description: "Package or plant tags, batch names, or order numbers." },
        created_today: { type: "boolean", description: "Packages created at this facility today." },
        all_active: { type: "boolean" },
        template: text("Template name; default if left out."),
        copies: { type: "integer", description: "Copies of each label, 1 to 50. Default 1." },
        expected_labels: { type: "integer", description: "How many labels the person asked for, if they said a number." },
      },
      ["label_type"],
    ),
    propose: async (s, input) =>
      guard(async () => {
        const kind = kindOf(input.label_type);
        const copies = input.copies === undefined ? 1 : Math.trunc(Number(input.copies));
        if (!(copies >= 1 && copies <= 50)) throw new InventoryError("Copies must be between 1 and 50.");
        const { ids, how } = await resolveRecords(s, kind, input);
        const templateId = await templateFor(s, kind, str(input.template));
        const p = await previewLabels(s, templateId, ids);
        const total = p.records.length * copies;
        if (input.expected_labels !== undefined && Number(input.expected_labels) !== total) {
          throw new InventoryError(
            `The person asked for ${Number(input.expected_labels)} labels, but ${how} gives ${p.records.length} record${p.records.length === 1 ? "" : "s"} × ${copies} cop${copies === 1 ? "y" : "ies"} = ${total}. Don't pad or trim; tell them the real count and ask how to proceed.`,
          );
        }
        if (p.blocked) {
          const top = summarize(p.issues.filter((i) => i.severity === "block")).slice(0, 5).map((i) => `${i.message} (${i.labels} label${i.labels === 1 ? "" : "s"})`);
          throw new InventoryError(`These labels can't print yet. ${top.join(" ")}`);
        }
        const warnings = p.issues.filter((i) => i.severity === "warn").length;
        const refs = p.records.map((r) => r.ref);
        // Made now and signed into the proposal, so confirming twice can't make two jobs.
        const key = crypto.randomUUID().replace(/-/g, "");
        return {
          title: "Prepare labels",
          details: [
            { label: "Template", value: `${p.template.name} v${p.version} (${p.design.widthMm} × ${p.design.heightMm} mm)` },
            { label: "Records", value: `${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ` and ${refs.length - 5} more` : ""}` },
            { label: "Labels", value: `${total}${copies > 1 ? ` (${copies} each)` : ""}` },
            { label: "Checks", value: warnings ? `Passed, with ${warnings} warning${warnings === 1 ? "" : "s"}` : "Passed" },
            { label: "Inventory", value: "Not changed" },
          ],
          action: { tool: "prepare_labels", args: { templateId, version: String(p.version), ids: ids.join(","), copies: String(copies), key } },
        };
      }),
    execute: async (actor, a) =>
      guard(async () => {
        const { job, duplicate } = await createPrintJob(actor, {
          templateId: a.templateId,
          templateVersion: Number(a.version),
          sourceIds: a.ids.split(",").filter(Boolean),
          copies: Number(a.copies),
          idempotencyKey: a.key,
        });
        return duplicate
          ? `That print job already exists (${job.labelCount} label${job.labelCount === 1 ? "" : "s"}). Open it from SmartLabel AI → Print queue.`
          : `Print job ready: ${job.labelCount} label${job.labelCount === 1 ? "" : "s"}. Open SmartLabel AI → Print queue, press Open PDF, and print at Actual size.`;
      }),
  },
];
