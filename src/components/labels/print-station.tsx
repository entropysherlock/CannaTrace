"use client";

import { Printer, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Field, inputClass } from "@/components/ui";
import type { LabelIssue, LabelKind } from "@/lib/labels/types";
import { LABEL_KINDS } from "@/lib/labels/types";
import { IssueList, type PackInfo } from "./issues";
import { JobActions, newRequestKey, printJobPdf } from "./job-actions";

export type TemplateOption = { id: string; name: string; kind: LabelKind; isDefault: boolean; jurisdiction: string | null; size: string };
export type PrinterOption = { id: string; name: string; isDefault: boolean };
export type CandidateRow = { id: string; ref: string; detail: string; status?: string };

type Preview = {
  template: { id: string; name: string; kind: LabelKind; version: number; jurisdiction: string | null };
  size: { widthMm: number; heightMm: number };
  count: number;
  previews: { ref: string; svg: string }[];
  issues: LabelIssue[];
  blocked: boolean;
  pack: PackInfo;
  checkedRules: number;
  manualRules: number;
};

/** Pick records, check them, preview at real size, and create one print job. */
export function PrintStation({
  templates,
  printers,
  candidates,
  initialKind,
  initialIds,
  canManage,
}: {
  templates: TemplateOption[];
  printers: PrinterOption[];
  candidates: Record<LabelKind, CandidateRow[]>;
  initialKind: LabelKind;
  initialIds: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<LabelKind>(initialKind);
  const pickTemplate = (k: LabelKind) => (templates.find((t) => t.kind === k && t.isDefault) ?? templates.find((t) => t.kind === k))?.id ?? "";
  const [templateId, setTemplateId] = useState(() => pickTemplate(initialKind));
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

  const shown = useMemo(() => {
    const rows = candidates[kind] ?? [];
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.ref} ${r.detail}`.toLowerCase().includes(q)) : rows;
  }, [candidates, kind, query]);
  const kindTemplates = templates.filter((t) => t.kind === kind);

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

  async function check() {
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetch("/api/labels/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, sourceIds: [...selected] }) });
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
      const printed = await printJobPdf(data.job.id);
      setJob({ ...data.job, status: printed.ok ? "RENDERED" : "FAILED", duplicate: data.duplicate });
      if (!printed.ok) setError(printed.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "The print job wasn't created.");
    } finally {
      setBusy(false);
    }
  }

  const askTowel = () => {
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

        <Field label="Template">
          {kindTemplates.length ? (
            <select
              className={inputClass}
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                reset();
              }}
            >
              {kindTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.size}
                  {t.isDefault ? " (default)" : ""}
                  {t.jurisdiction ? ` · ${t.jurisdiction} rules` : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              No template for this label type yet. {canManage ? <Link className="font-semibold text-brand-700 underline" href="/labels/templates/new">Make one</Link> : "Ask a manager to make one."}
            </p>
          )}
        </Field>

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
          <Field label="Printer" hint="Printer settings shift the label to line up with your stock. Set them up on the Printers tab.">
            <select className={inputClass} value={printerId} onChange={(e) => { setPrinterId(e.target.value); setJob(null); setRequestKey(newRequestKey()); }}>
              <option value="">No offset</option>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !templateId || selected.size === 0} onClick={check} className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-brand-600 bg-white px-5 text-sm font-bold text-brand-800 transition hover:bg-brand-50 disabled:opacity-50">
            Check and preview
          </button>
          <button type="button" onClick={askTowel} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50">
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Ask Cousin Towel
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
            <IssueList issues={preview.issues} blocked={preview.blocked} pack={preview.pack} checkedRules={preview.checkedRules} manualRules={preview.manualRules} count={preview.count} />
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
            ) : (
              <button type="button" disabled={busy || preview.blocked} onClick={createJob} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
                <Printer className="h-4 w-4" aria-hidden="true" />
                {preview.blocked ? "Fix the blocking problems to print" : `Print ${preview.count * copies} label${preview.count * copies === 1 ? "" : "s"}`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
