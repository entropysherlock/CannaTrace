import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { noteAudit } from "@/lib/audit-recorder";
import { auditLogs, labelTemplates, labelTemplateVersions, printJobs, printerProfiles } from "@/db/schema";
import { loadLabelRecords, type Scope } from "./data";
import { starterTemplates } from "./defaults";
import { parseDesign } from "./design";
import { renderLabelsPdf } from "./render-pdf";
import type { LabelDesign, LabelIssue, LabelKind } from "./types";
import { validateLabels } from "./validate";

export type LabelActor = Scope & { userId: string; userName: string };

export class LabelError extends Error {
  constructor(
    message: string,
    public issues: LabelIssue[] = [],
  ) {
    super(message);
  }
}

/** Retrying a job past this many attempts means something needs fixing first. */
export const MAX_ATTEMPTS = 5;
export const MAX_LABELS_PER_JOB = 2000;

async function log(actor: LabelActor, entityType: string, entityId: string, action: string, after?: unknown, reason?: string) {
  const [row] = await db
    .insert(auditLogs)
    .values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      userId: actor.userId,
      userName: actor.userName,
      entityType,
      entityId,
      action,
      after: after ?? null,
      reason: reason ?? null,
    })
    .returning({ id: auditLogs.id });
  noteAudit(row?.id);
}

// ---------------------------------------------------------------- templates

/**
 * Give a facility its starter templates: all of them the first time anyone opens labels there, and any
 * starter added in a later CannaTrace release (matched by name, so an edited or archived template is left alone).
 * Safe to call repeatedly.
 */
export async function ensureStarterTemplates(actor: LabelActor, state: string) {
  const have = new Set(
    (
      await db
        .select({ name: labelTemplates.name })
        .from(labelTemplates)
        .where(and(eq(labelTemplates.orgId, actor.orgId), eq(labelTemplates.facilityId, actor.facilityId)))
    ).map((r) => r.name),
  );
  // Only one default per label type: a starter is the default only if that type has none yet.
  const defaults = new Set(
    (
      await db
        .select({ kind: labelTemplates.kind })
        .from(labelTemplates)
        .where(and(eq(labelTemplates.orgId, actor.orgId), eq(labelTemplates.facilityId, actor.facilityId), eq(labelTemplates.isDefault, true)))
    ).map((r) => r.kind),
  );
  for (const s of starterTemplates(state)) {
    if (have.has(s.name)) continue;
    const isDefault = !defaults.has(s.kind);
    defaults.add(s.kind);
    await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(labelTemplates)
        .values({ orgId: actor.orgId, facilityId: actor.facilityId, name: s.name, kind: s.kind, jurisdiction: s.jurisdiction, isDefault })
        .onConflictDoNothing()
        .returning();
      if (!t) return; // Someone else created it at the same moment.
      await tx.insert(labelTemplateVersions).values({ templateId: t.id, version: 1, widthMm: String(s.design.widthMm), heightMm: String(s.design.heightMm), elements: s.design.elements, note: "Starter template", userName: "CannaTrace" });
    });
  }
}

export async function listTemplates(scope: Scope, opts: { includeArchived?: boolean } = {}) {
  const rows = await db
    .select({ t: labelTemplates, v: labelTemplateVersions })
    .from(labelTemplates)
    .innerJoin(labelTemplateVersions, and(eq(labelTemplateVersions.templateId, labelTemplates.id), eq(labelTemplateVersions.version, labelTemplates.currentVersion)))
    .where(and(eq(labelTemplates.orgId, scope.orgId), eq(labelTemplates.facilityId, scope.facilityId)))
    .orderBy(labelTemplates.kind, labelTemplates.name);
  return rows
    .filter((r) => opts.includeArchived || !r.t.archived)
    .map((r) => ({ ...r.t, design: toDesign(r.v), versionNote: r.v.note, versionBy: r.v.userName, versionAt: r.v.createdAt }));
}

function toDesign(v: typeof labelTemplateVersions.$inferSelect): LabelDesign {
  return { widthMm: Number(v.widthMm), heightMm: Number(v.heightMm), elements: v.elements as LabelDesign["elements"] };
}

/** A template and one of its versions (the current one unless asked). Only templates at this facility are found. */
export async function getTemplate(scope: Scope, templateId: string, version?: number) {
  const [t] = await db
    .select()
    .from(labelTemplates)
    .where(and(eq(labelTemplates.id, templateId), eq(labelTemplates.orgId, scope.orgId), eq(labelTemplates.facilityId, scope.facilityId)));
  if (!t) throw new LabelError("That label template was not found at this facility.");
  const [v] = await db
    .select()
    .from(labelTemplateVersions)
    .where(and(eq(labelTemplateVersions.templateId, t.id), eq(labelTemplateVersions.version, version ?? t.currentVersion)));
  if (!v) throw new LabelError(`Version ${version} of "${t.name}" doesn't exist.`);
  const versions = await db
    .select({ version: labelTemplateVersions.version, note: labelTemplateVersions.note, userName: labelTemplateVersions.userName, createdAt: labelTemplateVersions.createdAt })
    .from(labelTemplateVersions)
    .where(eq(labelTemplateVersions.templateId, t.id))
    .orderBy(desc(labelTemplateVersions.version));
  return { template: t, version: v.version, design: toDesign(v), versions };
}

/** The template a facility uses by default for a kind of label, if it has one. */
export async function defaultTemplateId(scope: Scope, kind: LabelKind): Promise<string | null> {
  const rows = await db
    .select({ id: labelTemplates.id, isDefault: labelTemplates.isDefault })
    .from(labelTemplates)
    .where(and(eq(labelTemplates.orgId, scope.orgId), eq(labelTemplates.facilityId, scope.facilityId), eq(labelTemplates.kind, kind), eq(labelTemplates.archived, false)))
    .orderBy(desc(labelTemplates.isDefault), labelTemplates.name);
  return rows[0]?.id ?? null;
}

const STATE_RE = /^[A-Z]{2}$/;

export async function createTemplate(actor: LabelActor, input: { name: string; kind: LabelKind; jurisdiction: string | null; design: unknown; copyOf?: string | null }) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new LabelError("Give the template a name.");
  const jurisdiction = input.jurisdiction ? input.jurisdiction.trim().toUpperCase() : null;
  if (jurisdiction && !STATE_RE.test(jurisdiction)) throw new LabelError("Use a two-letter state code, like NM.");
  let design: LabelDesign;
  if (input.copyOf) design = (await getTemplate(actor, input.copyOf)).design;
  else design = parseDesign(input.design);
  try {
    const id = await db.transaction(async (tx) => {
      const [t] = await tx.insert(labelTemplates).values({ orgId: actor.orgId, facilityId: actor.facilityId, name, kind: input.kind, jurisdiction }).returning();
      await tx.insert(labelTemplateVersions).values({ templateId: t.id, version: 1, widthMm: String(design.widthMm), heightMm: String(design.heightMm), elements: design.elements, note: input.copyOf ? "Copied" : "Created", userName: actor.userName });
      return t.id;
    });
    await log(actor, "label_template", id, "label_template.created", { name, kind: input.kind, jurisdiction });
    return id;
  } catch (e) {
    if (String((e as { code?: string }).code) === "23505") throw new LabelError(`A template named "${name}" already exists here.`);
    throw e;
  }
}

/**
 * Save a new version. Old versions are never changed, so every print job can show the exact layout it used.
 * `baseVersion` stops two people from silently overwriting each other's edits.
 */
export async function saveTemplateVersion(actor: LabelActor, templateId: string, input: { design: unknown; note?: string; baseVersion: number; name?: string; jurisdiction?: string | null }) {
  const design = parseDesign(input.design);
  const jurisdiction = input.jurisdiction === undefined ? undefined : input.jurisdiction ? input.jurisdiction.trim().toUpperCase() : null;
  if (jurisdiction && !STATE_RE.test(jurisdiction)) throw new LabelError("Use a two-letter state code, like NM.");
  const next = await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(labelTemplates)
      .where(and(eq(labelTemplates.id, templateId), eq(labelTemplates.orgId, actor.orgId), eq(labelTemplates.facilityId, actor.facilityId)))
      .for("update");
    if (!t) throw new LabelError("That label template was not found at this facility.");
    if (t.currentVersion !== input.baseVersion) throw new LabelError(`Someone saved version ${t.currentVersion} while you were editing. Reload to see their changes.`);
    const version = t.currentVersion + 1;
    await tx.insert(labelTemplateVersions).values({ templateId, version, widthMm: String(design.widthMm), heightMm: String(design.heightMm), elements: design.elements, note: input.note?.trim().slice(0, 200) || null, userName: actor.userName });
    await tx
      .update(labelTemplates)
      .set({ currentVersion: version, updatedAt: new Date(), ...(input.name?.trim() ? { name: input.name.trim().slice(0, 80) } : {}), ...(jurisdiction !== undefined ? { jurisdiction } : {}) })
      .where(eq(labelTemplates.id, templateId));
    return version;
  });
  await log(actor, "label_template", templateId, "label_template.version_saved", { version: next, note: input.note ?? null });
  return next;
}

export async function setDefaultTemplate(actor: LabelActor, templateId: string) {
  const { template } = await getTemplate(actor, templateId);
  await db.transaction(async (tx) => {
    await tx
      .update(labelTemplates)
      .set({ isDefault: false })
      .where(and(eq(labelTemplates.orgId, actor.orgId), eq(labelTemplates.facilityId, actor.facilityId), eq(labelTemplates.kind, template.kind)));
    await tx.update(labelTemplates).set({ isDefault: true, archived: false }).where(eq(labelTemplates.id, templateId));
  });
  await log(actor, "label_template", templateId, "label_template.made_default", { kind: template.kind });
}

export async function setTemplateArchived(actor: LabelActor, templateId: string, archived: boolean) {
  await getTemplate(actor, templateId);
  await db.update(labelTemplates).set({ archived, ...(archived ? { isDefault: false } : {}) }).where(eq(labelTemplates.id, templateId));
  await log(actor, "label_template", templateId, archived ? "label_template.archived" : "label_template.restored");
}

// ---------------------------------------------------------------- printers

export const PRINTER_ADAPTERS = [
  { id: "BROWSER_PDF", name: "Browser PDF", ready: true, note: "Opens an exact-size PDF; print it from the browser's print dialog at Actual size (100%)." },
  { id: "ZPL", name: "Zebra ZPL (direct)", ready: false, note: "Planned. Needs a print bridge on a computer next to the printer. Not built yet." },
] as const;

export async function listPrinters(scope: Scope) {
  return db
    .select()
    .from(printerProfiles)
    .where(and(eq(printerProfiles.orgId, scope.orgId), eq(printerProfiles.facilityId, scope.facilityId)))
    .orderBy(desc(printerProfiles.isDefault), printerProfiles.name);
}

export async function savePrinter(actor: LabelActor, input: { id?: string | null; name: string; offsetXMm: number; offsetYMm: number; isDefault: boolean }) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new LabelError("Give the printer a name, like \"Packaging room Zebra\".");
  for (const v of [input.offsetXMm, input.offsetYMm]) if (!Number.isFinite(v) || Math.abs(v) > 20) throw new LabelError("Offsets must be between -20 and 20 mm.");
  const values = { name, adapter: "BROWSER_PDF", offsetXMm: String(input.offsetXMm), offsetYMm: String(input.offsetYMm), isDefault: input.isDefault };
  try {
    const id = await db.transaction(async (tx) => {
      if (input.isDefault) await tx.update(printerProfiles).set({ isDefault: false }).where(and(eq(printerProfiles.orgId, actor.orgId), eq(printerProfiles.facilityId, actor.facilityId)));
      if (input.id) {
        const [row] = await tx
          .update(printerProfiles)
          .set(values)
          .where(and(eq(printerProfiles.id, input.id), eq(printerProfiles.orgId, actor.orgId), eq(printerProfiles.facilityId, actor.facilityId)))
          .returning({ id: printerProfiles.id });
        if (!row) throw new LabelError("That printer was not found at this facility.");
        return row.id;
      }
      const [row] = await tx.insert(printerProfiles).values({ ...values, orgId: actor.orgId, facilityId: actor.facilityId }).returning({ id: printerProfiles.id });
      return row.id;
    });
    await log(actor, "printer", id, input.id ? "printer.updated" : "printer.added", values);
    return id;
  } catch (e) {
    if (String((e as { code?: string }).code) === "23505") throw new LabelError(`A printer named "${name}" already exists here.`);
    throw e;
  }
}

async function printerFor(scope: Scope, printerId: string | null | undefined) {
  if (!printerId) {
    const [def] = await db
      .select()
      .from(printerProfiles)
      .where(and(eq(printerProfiles.orgId, scope.orgId), eq(printerProfiles.facilityId, scope.facilityId), eq(printerProfiles.isDefault, true)));
    return def ?? null;
  }
  const [p] = await db
    .select()
    .from(printerProfiles)
    .where(and(eq(printerProfiles.id, printerId), eq(printerProfiles.orgId, scope.orgId), eq(printerProfiles.facilityId, scope.facilityId)));
  if (!p) throw new LabelError("That printer was not found at this facility.");
  return p;
}

// ---------------------------------------------------------------- checks and print jobs

/** Load real records and run every check, without creating anything. */
export async function previewLabels(scope: Scope, templateId: string, sourceIds: string[], version?: number) {
  const { template, design, version: v } = await getTemplate(scope, templateId, version);
  const records = await loadLabelRecords(scope, template.kind, sourceIds);
  const result = validateLabels(design, template.kind, template.jurisdiction, records);
  return { template, version: v, design, records, ...result };
}

export type CreateJobInput = {
  templateId: string;
  sourceIds: string[];
  copies?: number;
  /** A random key made once per print request (per click), so a double click or a retry doesn't make two jobs. */
  idempotencyKey: string;
  printerId?: string | null;
  reprintOf?: string | null;
  templateVersion?: number;
};

/**
 * Record a print job after the checks pass. This never touches inventory; it only reads records
 * and writes the job and an audit entry. A blocked request is still logged, as a failed job, so the history shows it.
 */
export async function createPrintJob(actor: LabelActor, input: CreateJobInput) {
  const key = input.idempotencyKey.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new LabelError("The print request is missing its request id. Reload the page and try again.");
  const existing = await findJobByKey(actor, key);
  if (existing) return { job: existing, duplicate: true as const };

  const copies = Math.trunc(input.copies ?? 1);
  if (!(copies >= 1 && copies <= 50)) throw new LabelError("Copies must be between 1 and 50.");
  const preview = await previewLabels(actor, input.templateId, input.sourceIds, input.templateVersion);
  const labelCount = preview.records.length * copies;
  if (labelCount > MAX_LABELS_PER_JOB) throw new LabelError(`That's ${labelCount} labels. Print at most ${MAX_LABELS_PER_JOB} in one job.`);
  const printer = await printerFor(actor, input.printerId);
  const blocking = preview.issues.filter((i) => i.severity === "block");

  const [inserted] = await db
    .insert(printJobs)
    .values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      templateId: preview.template.id,
      templateVersion: preview.version,
      printerProfileId: printer?.id ?? null,
      sourceType: preview.template.kind,
      // The ids the request named (orders for transfer labels), so a retry or reprint rebuilds the same set.
      sourceIds: [...new Set(input.sourceIds)],
      copies,
      labelCount,
      status: blocking.length ? "FAILED" : "QUEUED",
      error: blocking.length ? `Blocked by ${blocking.length} check${blocking.length === 1 ? "" : "s"}: ${blocking[0].message}` : null,
      idempotencyKey: key,
      reprintOf: input.reprintOf ?? null,
      warnings: preview.issues.filter((i) => i.severity !== "info"),
      userId: actor.userId,
      userName: actor.userName,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    // The same request arrived twice at the same moment; the other one won.
    const job = await findJobByKey(actor, key);
    return { job: job!, duplicate: true as const };
  }
  await log(actor, "print_job", inserted.id, input.reprintOf ? "labels.reprint_requested" : "labels.print_requested", {
    template: preview.template.name,
    version: preview.version,
    labels: labelCount,
    refs: preview.records.slice(0, 20).map((r) => r.ref),
    blocked: blocking.length > 0,
  });
  if (blocking.length) throw new LabelError("These labels can't print until the blocking problems are fixed.", preview.issues);
  return { job: inserted, duplicate: false as const };
}

async function findJobByKey(scope: Scope, key: string) {
  const [job] = await db.select().from(printJobs).where(and(eq(printJobs.orgId, scope.orgId), eq(printJobs.idempotencyKey, key)));
  if (job && job.facilityId !== scope.facilityId) throw new LabelError("That print request belongs to another facility.");
  return job ?? null;
}

export async function getJob(scope: Scope, jobId: string) {
  const [job] = await db.select().from(printJobs).where(and(eq(printJobs.id, jobId), eq(printJobs.orgId, scope.orgId), eq(printJobs.facilityId, scope.facilityId)));
  if (!job) throw new LabelError("That print job was not found at this facility.");
  return job;
}

/**
 * Build the PDF for a job. Data is re-read and re-checked every time, so a reprint can't
 * show stale or since-failed values. Each attempt is counted; failures are recorded on the job.
 */
export async function renderJob(actor: LabelActor, jobId: string): Promise<{ pdf: Uint8Array; fileName: string }> {
  const job = await getJob(actor, jobId);
  if (job.status === "CANCELLED") throw new LabelError("This job was cancelled.");
  if (job.status === "FAILED" && job.attempts === 0 && job.error?.startsWith("Blocked")) throw new LabelError(job.error);
  if (job.attempts >= MAX_ATTEMPTS) throw new LabelError(`This job has been tried ${job.attempts} times. Fix the problem, then start a new print.`);
  await db.update(printJobs).set({ attempts: sql`${printJobs.attempts} + 1` }).where(eq(printJobs.id, job.id));
  try {
    const preview = await previewLabels(actor, job.templateId, job.sourceIds as string[], job.templateVersion);
    const blocking = preview.issues.filter((i) => i.severity === "block");
    if (blocking.length) throw new LabelError(`The records changed and now fail a check: ${blocking[0].message}`, preview.issues);
    const printer = job.printerProfileId ? await printerFor(actor, job.printerProfileId) : null;
    const pdf = await renderLabelsPdf(preview.design, preview.records, {
      copies: job.copies,
      offsetXMm: printer ? Number(printer.offsetXMm) : 0,
      offsetYMm: printer ? Number(printer.offsetYMm) : 0,
      title: `${preview.template.name} (${job.labelCount} labels)`,
    });
    await db
      .update(printJobs)
      .set({ status: job.status === "PRINTED" ? "PRINTED" : "RENDERED", error: null })
      .where(eq(printJobs.id, job.id));
    return { pdf, fileName: `labels-${job.id.slice(0, 8)}.pdf` };
  } catch (e) {
    const message = e instanceof Error ? e.message : "The labels could not be made.";
    await db.update(printJobs).set({ status: "FAILED", error: message.slice(0, 500) }).where(eq(printJobs.id, job.id));
    await log(actor, "print_job", job.id, "labels.render_failed", { attempt: job.attempts + 1 }, message.slice(0, 200));
    throw e instanceof LabelError ? e : new LabelError(message);
  }
}

/**
 * Browsers don't report whether paper actually came out, so a person confirms it.
 * Only the person's answer moves a job to Printed.
 */
export async function markJob(actor: LabelActor, jobId: string, status: "PRINTED" | "FAILED" | "CANCELLED", note?: string) {
  const job = await getJob(actor, jobId);
  if (status === "PRINTED" && job.status !== "RENDERED" && job.status !== "PRINTED") throw new LabelError("Open the PDF before marking the job printed.");
  if (job.status === "CANCELLED") throw new LabelError("This job was cancelled.");
  await db
    .update(printJobs)
    .set({ status, completedAt: status === "PRINTED" ? new Date() : job.completedAt, error: status === "FAILED" ? note?.slice(0, 500) || "Marked as failed" : status === "PRINTED" ? null : job.error })
    .where(eq(printJobs.id, job.id));
  await log(actor, "print_job", job.id, `labels.marked_${status.toLowerCase()}`, { labels: job.labelCount }, note);
}

/** Start a new job for the same records with the same template version. Inventory is not touched. */
export async function reprintJob(actor: LabelActor, jobId: string, idempotencyKey: string, copies?: number) {
  const job = await getJob(actor, jobId);
  return createPrintJob(actor, {
    templateId: job.templateId,
    templateVersion: job.templateVersion,
    sourceIds: job.sourceIds as string[],
    copies: copies ?? job.copies,
    idempotencyKey,
    printerId: job.printerProfileId,
    reprintOf: job.id,
  });
}

export async function listJobs(scope: Scope, limit = 50) {
  return db
    .select({ job: printJobs, template: labelTemplates.name })
    .from(printJobs)
    .innerJoin(labelTemplates, eq(labelTemplates.id, printJobs.templateId))
    .where(and(eq(printJobs.orgId, scope.orgId), eq(printJobs.facilityId, scope.facilityId)))
    .orderBy(desc(printJobs.createdAt))
    .limit(limit);
}

/**
 * A calibration label: a box 1 mm inside each edge, centre lines, and 10 mm ticks.
 * If the box is off-centre on the printed sticker, the difference is the printer offset to save.
 */
export async function testPrint(actor: LabelActor, input: { widthMm: number; heightMm: number; printerId?: string | null }) {
  const { widthMm: W, heightMm: H } = input;
  if (!(W >= 10 && W <= 300 && H >= 10 && H <= 300)) throw new LabelError("Test labels must be 10 to 300 mm on each side.");
  const printer = input.printerId ? await printerFor(actor, input.printerId) : null;
  const elements: LabelDesign["elements"] = [
    { id: "box", type: "box", x: 1, y: 1, w: W - 2, h: H - 2, stroke: 0.3 },
    { id: "h", type: "line", x: 1, y: H / 2, w: W - 2, h: 0.2, stroke: 0.2 },
    { id: "v", type: "line", x: W / 2, y: 1, w: 0.2, h: H - 2, stroke: 0.2 },
  ];
  for (let x = 10; x < W - 1; x += 10) elements.push({ id: `t${x}`, type: "line", x, y: 1, w: 0.2, h: 3, stroke: 0.2 });
  elements.push({ id: "txt", type: "text", x: 3, y: 4.5, w: Math.max(6, W / 2 - 4), h: Math.max(4, H / 2 - 6), text: `Test ${W} × ${H} mm. Box should sit 1 mm in from every edge.`, fontSize: Math.min(7, Math.max(4, W / 14)) });
  const pdf = await renderLabelsPdf({ widthMm: W, heightMm: H, elements }, [{ ref: "test", sourceId: "test", values: {} }], {
    offsetXMm: printer ? Number(printer.offsetXMm) : 0,
    offsetYMm: printer ? Number(printer.offsetYMm) : 0,
    title: "CannaTrace test label",
  });
  await log(actor, "printer", printer?.id ?? "none", "labels.test_print", { widthMm: W, heightMm: H });
  return pdf;
}
