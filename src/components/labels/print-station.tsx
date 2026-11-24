"use client";

import { Printer, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { quickPrinterAction, quickTemplateAction } from "@/app/(app)/quick-create-actions";
import { CreatableSelect } from "@/components/contextual-create";
import { Field, inputClass } from "@/components/ui";
import type { LabelIssue, LabelKind } from "@/lib/labels/types";
import { LABEL_KINDS } from "@/lib/labels/types";
import { IssueList, type IssueLink, type PackInfo } from "./issues";
import { JobActions, newRequestKey, printJob } from "./job-actions";

export type TemplateOption = { id: string; name: string; kind: LabelKind; isDefault: boolean; jurisdiction: string | null; size: string };
export type ArchivedTemplate = { id: string; name: string; kind: LabelKind };

/** Where a new template starts: a copy of one you have (named here), or an archived one brought back. */
function TemplateSourceFields({ copies, archived }: { copies: TemplateOption[]; archived: ArchivedTemplate[] }) {
  const first = copies[0] ? `copy:${copies[0].id}` : archived[0] ? `restore:${archived[0].id}` : "";
  const [source, setSource] = useState(first);
  const copying = source.startsWith("copy:");
  return (
    <>
      <Field label="Start from">
        <select name="source" required value={source} onChange={(e) => setSource(e.target.value)} className={inputClass}>
          {copies.map((t) => (
            <option key={t.id} value={`copy:${t.id}`}>
              A copy of {t.name}
            </option>
          ))}
          {archived.map((t) => (
            <option key={t.id} value={`restore:${t.id}`}>
              Bring back {t.name} (archived)
            </option>
          ))}
        </select>
      </Field>
      {copying ? (
        <Field label="Name for the new template">
          <input name="name" required maxLength={80} className={inputClass} />
        </Field>
      ) : null}
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" name="makeDefault" className="h-5 w-5 accent-brand-700" /> Make it the default for this label type
      </label>
    </>
  );
}

/** A printer preset: the same things the Printers tab asks for. */
function PrinterFields() {
  return (
    <>
      <Field label="Printer name">
        <input name="name" required maxLength={60} placeholder="Packaging room Zebra" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Shift right (mm)">
          <input name="offsetXMm" type="number" step="0.1" min={-20} max={20} defaultValue={0} className={inputClass} />
        </Field>
        <Field label="Shift down (mm)">
          <input name="offsetYMm" type="number" step="0.1" min={-20} max={20} defaultValue={0} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="How it prints">
          <select name="adapter" defaultValue="BROWSER_PDF" className={inputClass}>
            <option value="BROWSER_PDF">Browser print dialog (PDF)</option>
            <option value="ZPL">Zebra, direct (needs Zebra Browser Print)</option>
          </select>
        </Field>
        <Field label="Zebra resolution">
          <select name="dpi" defaultValue="203" className={inputClass}>
            <option value="203">203 dpi (most desktop Zebras)</option>
            <option value="300">300 dpi</option>
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" name="isDefault" className="h-5 w-5 accent-brand-700" /> Use this printer by default
      </label>
    </>
  );
}
export type PrinterOption = { id: string; name: string; isDefault: boolean };
export type CandidateRow = { id: string; ref: string; detail: string; status?: string };

type Preview = {
  template: { id: string; name: string; kind: LabelKind; version: number; jurisdiction: string | null };
  size: { widthMm: number; heightMm: number };
  count: number;
  previews: { ref: string; svg: string }[];
  records?: { ref: string; sourceId: string }[];
  issues: LabelIssue[];
  blocked: boolean;
  pack: PackInfo;
  checkedRules: number;
  manualRules: number;
};

/** Where a person goes to fix a record's data, by label type. */
function recordHref(kind: LabelKind, id: string): string | null {
  if (kind === "PACKAGE" || kind === "PRODUCT") return `/inventory/${id}`;
  if (kind === "BATCH") return `/cultivation/batches/${id}`;
  if (kind === "TRANSFER") return `/distribution/orders/${id}`;
  if (kind === "PLANT") return "/cultivation/plants";
  return null;
}

/** Pick records, check them, preview at real size, and create one print job. */
export function PrintStation({
  templates,
  archivedTemplates = [],
  printers,
  candidates,
  initialKind,
  initialIds,
  initialTemplateId,
  canManage,
}: {
  templates: TemplateOption[];
  /** Archived templates, which "+ Add template" can bring back. */
  archivedTemplates?: ArchivedTemplate[];
  printers: PrinterOption[];
  candidates: Record<LabelKind, CandidateRow[]>;
  initialKind: LabelKind;
  initialIds: string[];
  /** A template chosen before arriving here, such as from the template editor's Print button. */
  initialTemplateId?: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<LabelKind>(initialKind);
  const pickTemplate = (k: LabelKind) => (templates.find((t) => t.kind === k && t.isDefault) ?? templates.find((t) => t.kind === k))?.id ?? "";
  const [templateId, setTemplateId] = useState(() => (initialTemplateId && templates.some((t) => t.id === initialTemplateId && t.kind === initialKind) ? initialTemplateId : pickTemplate(initialKind)));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialIds));
  const [query, setQuery] = useState("");
  const [copies, setCopies] = useState(1);
  const [printerId, setPrinterId] = useState(printers.find((p) => p.isDefault)?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ id: string; status: string; labelCount: number; duplicate: boolean } | null>(null);
  // One key per checked request: pressing Print twice, or retrying after a dropped connection, can't make two jobs.
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const issuesRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const rows = candidates[kind] ?? [];
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.ref} ${r.detail}`.toLowerCase().includes(q)) : rows;
  }, [candidates, kind, query]);
  const kindTemplates = templates.filter((t) => t.kind === kind);
  const kindArchived = archivedTemplates.filter((t) => t.kind === kind);
  const kindLabel = LABEL_KINDS.find((k) => k.kind === kind)?.label ?? "Label";

  function reset() {
    setPreview(null);
    setJob(null);
    setError(null);
    setRequestKey(newRequestKey());
  }
  function changeKind(k: LabelKind) {
    setKind(k);
    setTemplateId(pickTemplate(k));
    setSelected(new Set());
    reset();
  }
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    reset();
  }

  async function check(ids: string[] = [...selected]) {
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetch("/api/labels/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, sourceIds: ids }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data);
      setRequestKey(newRequestKey());
    } catch (e) {
      setPreview(null);
      setError((e as Error).message || "The check didn't run.");
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/labels/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, sourceIds: [...selected], copies, printerId: printerId || null, idempotencyKey: requestKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.issues?.length && preview) setPreview({ ...preview, issues: data.issues, blocked: true });
        throw new Error(data.error);
      }
      // One click: create the job, then go straight to the print dialog.
      const printed = await printJob(data.job.id);
      setJob({ ...data.job, status: printed.ok ? "RENDERED" : "FAILED", duplicate: data.duplicate });
      if (!printed.ok) setError(printed.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "The print job wasn't created.");
    } finally {
      setBusy(false);
    }
  }

  // Which chosen records have a problem that blocks printing. A record-level problem names the record in
  // recordRef (a transfer's labels are "<order> · <line>"), so match on the record's own reference.
  const rows = candidates[kind] ?? [];
  // The check reports which record each label came from; fall back to the list for older responses.
  const recordFor = (ref: string | undefined): { id: string; ref: string } | undefined => {
    if (!ref) return undefined;
    const hit = preview?.records?.find((r) => r.ref === ref);
    if (hit) return { id: hit.sourceId, ref: rows.find((r) => r.id === hit.sourceId)?.ref ?? ref };
    return rows.find((r) => selected.has(r.id) && (r.ref === ref || ref.startsWith(`${r.ref} · `)));
  };
  const blocking = preview?.issues.filter((i) => i.severity === "block") ?? [];
  const blockedIds = new Set(blocking.map((i) => recordFor(i.recordRef)?.id).filter((x): x is string => Boolean(x)));
  const designBlocked = blocking.some((i) => !recordFor(i.recordRef));
  const printable = [...selected].filter((id) => !blockedIds.has(id));

  /** A link to where each problem can be fixed: the record's own page, or the template for design problems. */
  const linkFor = (issue: LabelIssue): IssueLink | null => {
    const record = recordFor(issue.recordRef);
    if (record) {
      const href = recordHref(kind, record.id);
      if (!href) return null;
      const lab = issue.code === "LAB_MISSING" || issue.code === "LAB_FAILED" || /lab result/i.test(issue.fix ?? "");
      return { href, label: lab ? `Open ${record.ref} to add its lab result` : `Open ${record.ref}` };
    }
    if (issue.recordRef || !preview) return null;
    return canManage ? { href: `/labels/templates/${preview.template.id}`, label: "Fix it in the template" } : { href: null, label: "A manager can fix this in the template." };
  };

  function showProblems() {
    issuesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    issuesRef.current?.focus({ preventScroll: true });
  }

  function leaveOutBlocked() {
    const next = new Set(printable);
    setSelected(next);
    void check([...next]);
  }

  const askTally = () => {
    const problems = preview?.issues.filter((i) => i.severity !== "info").slice(0, 8).map((i) => `- ${i.message}${i.fix ? ` (${i.fix})` : ""}`).join("\n");
    const prompt = problems
      ? `I'm printing ${preview?.template.name} labels and the checker found these problems:\n${problems}\nExplain what each means and how to fix it.`
      : "Help me print labels. What should I check before printing?";
    window.dispatchEvent(new CustomEvent("open-assistant", { detail: prompt }));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="space-y-4 rounded-xl border border-brand-100 bg-white p-4 shadow-sm sm:p-5">
        <div role="tablist" aria-label="Label type" className="flex flex-wrap gap-1.5">
          {LABEL_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="tab"
              aria-selected={kind === k.kind}
              title={k.hint}
              onClick={() => changeKind(k.kind)}
              className={`min-h-9 rounded-full px-3 text-sm font-semibold transition ${kind === k.kind ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-800 hover:bg-brand-100"}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* Remounted per label type, so each type keeps its own list and choice. */}
        <CreatableSelect
          key={kind}
          name="templateId"
          label="Template"
          required
          placeholder="Choose a template"
          defaultValue={templateId}
          options={kindTemplates.map((t) => ({
            id: t.id,
            label: `${t.name} · ${t.size}${t.isDefault ? " (default)" : ""}${t.jurisdiction ? ` · ${t.jurisdiction} rules` : ""}`,
          }))}
          onChange={(id) => {
            setTemplateId(id);
            reset();
          }}
          create={
            canManage && kindTemplates.length + kindArchived.length > 0
              ? {
                  buttonLabel: "Add template",
                  title: `Add a ${kindLabel.toLowerCase()} template`,
                  intro: "Start from one you have. It's picked here, and your chosen records stay chosen. Fine-tune it later in the designer.",
                  submitLabel: "Save template",
                  action: quickTemplateAction,
                  fields: <TemplateSourceFields copies={kindTemplates} archived={kindArchived} />,
                }
              : undefined
          }
          deniedHint={
            canManage ? (
              <>
                No {kindLabel.toLowerCase()} template to start from yet.{" "}
                <Link className="font-semibold text-brand-700 underline" href="/labels/templates/new" target="_blank" rel="noopener">
                  Design one in a new tab
                </Link>
                , then come back. What you&apos;ve chosen here stays put.
              </>
            ) : (
              "Template missing? Ask a manager to make one."
            )
          }
        />

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800">
              Records <span className="font-normal text-slate-500">({selected.size} chosen)</span>
            </span>
            <div className="flex gap-2 text-xs font-semibold">
              <button type="button" className="text-brand-700 hover:underline" onClick={() => { setSelected(new Set([...selected, ...shown.map((r) => r.id)])); reset(); }}>
                Select all shown
              </button>
              <button type="button" className="text-slate-600 hover:underline" onClick={() => { setSelected(new Set()); reset(); }}>
                Clear
              </button>
            </div>
          </div>
          <label className="relative block">
            <span className="sr-only">Search records</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className={`${inputClass} pl-9`} placeholder="Search tag, name, or customer" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" data-testid="label-records">
            {shown.length === 0 ? <li className="px-3 py-4 text-sm text-slate-500">Nothing here to label.</li> : null}
            {shown.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-brand-50/60">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-semibold text-slate-900">{r.ref}</span>
                    <span className="block truncate text-xs text-slate-600">{r.detail}</span>
                  </span>
                  {r.status && r.status !== "ACTIVE" ? <span className="text-[11px] font-bold uppercase text-amber-700">{r.status.replace("_", " ").toLowerCase()}</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Copies of each">
            <input type="number" min={1} max={50} className={inputClass} value={copies} onChange={(e) => { setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1))); setJob(null); setRequestKey(newRequestKey()); }} />
          </Field>
          <CreatableSelect
            name="printerId"
            label="Printer"
            hint="Printer settings shift the label to line up with your stock."
            placeholder="No offset"
            defaultValue={printerId}
            options={printers.map((p) => ({ id: p.id, label: p.name }))}
            onChange={(id) => {
              setPrinterId(id);
              setJob(null);
              setRequestKey(newRequestKey());
            }}
            create={
              canManage
                ? {
                    buttonLabel: "Add printer",
                    title: "Add a printer",
                    intro: "Saved to your printers and picked for this job.",
                    submitLabel: "Save printer",
                    action: quickPrinterAction,
                    fields: <PrinterFields />,
                  }
                : undefined
            }
            compact
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !templateId || selected.size === 0} onClick={() => check()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-brand-600 bg-white px-5 text-sm font-bold text-brand-800 transition hover:bg-brand-50 disabled:opacity-50">
            Check and preview
          </button>
          <button type="button" data-assistant-trigger onClick={askTally} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50">
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Ask Tally
          </button>
        </div>
        {error ? (
          <p role="alert" className="rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
            {error}
          </p>
        ) : null}
      </section>

      <section className="min-w-0 space-y-4 rounded-xl border border-brand-100 bg-white p-4 shadow-sm sm:p-5" aria-live="polite">
        {!preview ? (
          <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 text-center text-slate-500">
            <Printer className="h-10 w-10 text-brand-300" aria-hidden="true" />
            <p className="max-w-sm text-sm">Choose records, then press Check and preview. Labels fill in from saved records, so there&apos;s nothing to type.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-brand-950">
                {preview.count} label{preview.count === 1 ? "" : "s"} · {preview.template.name} v{preview.template.version}
                <span className="ml-2 text-sm font-medium text-slate-500">
                  {preview.size.widthMm} × {preview.size.heightMm} mm
                </span>
              </h2>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={actualSize} onChange={(e) => setActualSize(e.target.checked)} />
                Actual size
              </label>
            </div>
            <div className="flex max-h-[28rem] flex-wrap gap-3 overflow-auto rounded-lg bg-slate-100 p-3" data-testid="label-previews">
              {preview.previews.map((p) => (
                <figure key={p.ref} className="space-y-1">
                  <div
                    className="bg-white shadow ring-1 ring-slate-300 [&>svg]:block"
                    style={actualSize ? undefined : { width: `${Math.min(340, preview.size.widthMm * 3.4)}px` }}
                    // The SVG is built on our server from escaped record values.
                    dangerouslySetInnerHTML={{ __html: actualSize ? p.svg : p.svg.replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%"') }}
                  />
                  <figcaption className="font-mono text-[11px] text-slate-600">{p.ref}</figcaption>
                </figure>
              ))}
              {preview.count > preview.previews.length ? <p className="self-center text-xs text-slate-600">+ {preview.count - preview.previews.length} more</p> : null}
            </div>
            <div ref={issuesRef} tabIndex={-1} className="scroll-mt-24 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-red-400">
              <IssueList issues={preview.issues} blocked={preview.blocked} pack={preview.pack} checkedRules={preview.checkedRules} manualRules={preview.manualRules} count={preview.count} linkFor={linkFor} />
            </div>
            {job ? (
              <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-3" data-testid="label-job">
                <p className="text-sm font-semibold text-brand-900">
                  {job.duplicate ? "This print was already started; here it is." : `Sent ${job.labelCount} label${job.labelCount === 1 ? "" : "s"} to the print dialog.`}
                </p>
                <p className="text-xs text-brand-900">
                  In the print dialog pick your label printer, set paper to {preview.size.widthMm} × {preview.size.heightMm} mm, scale to 100% (Actual size), and margins to none. Then tell us whether it printed. Closed the dialog by mistake? Press Print again.
                </p>
                <JobActions id={job.id} status={job.status} />
              </div>
            ) : preview.blocked ? (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3" data-testid="label-blocked-actions">
                <p className="text-sm font-semibold text-red-900">
                  {blockedIds.size && !designBlocked
                    ? `${blockedIds.size} of ${selected.size} label${selected.size === 1 ? "" : "s"} can't print until ${blockedIds.size === 1 ? "its record is" : "their records are"} fixed.`
                    : designBlocked
                      ? "The template has a problem that stops every label from printing. Use the link next to it to fix the template."
                      : "These labels can't print until the problems above are fixed."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={showProblems} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-red-700">
                    Show what to fix
                  </button>
                  {!designBlocked && blockedIds.size && printable.length ? (
                    <button type="button" disabled={busy} onClick={leaveOutBlocked} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-brand-300 bg-white px-4 text-sm font-bold text-brand-800 transition hover:bg-brand-50 disabled:opacity-50">
                      <Printer className="h-4 w-4" aria-hidden="true" />
                      Leave {blockedIds.size === 1 ? "it" : "them"} out and print the other {printable.length}
                    </button>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => check()} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                    I fixed it, check again
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={createJob} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
                <Printer className="h-4 w-4" aria-hidden="true" />
                {`Print ${preview.count * copies} label${preview.count * copies === 1 ? "" : "s"}`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
