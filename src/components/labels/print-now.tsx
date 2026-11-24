"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { inputClass } from "@/components/ui";
import type { LabelDesign, LabelIssue, LabelKind } from "@/lib/labels/types";
import { newRequestKey, printJob } from "./job-actions";
import type { PreviewRecord } from "./field-panel";

/**
 * Print from the template editor in one step: the previewed record, this many copies. A saved job is made first, so
 * it is checked and recorded like any other print; unsaved edits are saved before printing.
 */
export function PrintNow({
  kind,
  design,
  sampleValues,
  record,
  dirty,
  ensureSaved,
}: {
  kind: LabelKind;
  design: LabelDesign;
  /** What the preview shows now, sent with a sample so the PDF matches the screen. */
  sampleValues: Record<string, string | null>;
  record: PreviewRecord | null;
  dirty: boolean;
  /** Saves the template (creating it on the New template page) and returns its id, or null if it couldn't be saved. */
  ensureSaved: () => Promise<string | null>;
}) {
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string; issues?: LabelIssue[] } | null>(null);

  async function print() {
    if (!record) return;
    setBusy(true);
    setResult(null);
    try {
      const templateId = await ensureSaved();
      if (!templateId) {
        setResult({ error: "The template didn't save, so nothing was printed." });
        return;
      }
      const res = await fetch("/api/labels/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, sourceIds: [record.sourceId], copies, idempotencyKey: newRequestKey() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.error ?? "Nothing was printed.", issues: (data.issues as LabelIssue[] | undefined)?.filter((i) => i.severity === "block").slice(0, 5) });
        return;
      }
      const printed = await printJob(data.job.id);
      setResult(printed.ok ? { ok: `Sent ${data.job.labelCount} label${data.job.labelCount === 1 ? "" : "s"} for ${record.ref} to print. Pick your printer in the print window.` } : { error: printed.error });
    } catch (e) {
      setResult({ error: (e as Error).message || "Nothing was printed." });
    } finally {
      setBusy(false);
    }
  }

  /** The design as it is on screen, with example data, opened as a PDF. Needs no saved template and no package. */
  async function sample() {
    setResult(null);
    // Opened first, inside the click, so the browser doesn't block the new tab.
    const tab = window.open("", "_blank");
    try {
      const res = await fetch("/api/labels/sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, design, values: sampleValues, copies }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The sample couldn't be made.");
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    } catch (e) {
      tab?.close();
      setResult({ error: (e as Error).message });
    }
  }

  return (
    <section className="space-y-3 rounded-xl border-2 border-brand-600 bg-white p-4 shadow-sm" data-testid="print-now">
      <h2 className="flex items-center gap-2 font-bold text-brand-950">
        <Printer className="h-5 w-5 text-brand-700" aria-hidden="true" /> Print this template
      </h2>
      {record ? (
        <p className="text-sm text-slate-700">
          Prints <span className="font-semibold">{record.ref}</span>. Change it with the &ldquo;Preview with a real package&rdquo; box above the label.
        </p>
      ) : (
        <p className="text-sm text-slate-700">Pick a package in the &ldquo;Preview with a real package&rdquo; box above the label, then print it here.</p>
      )}
      <div className="flex items-end gap-2">
        <label className="w-24 text-sm font-semibold text-slate-700">
          Copies
          <input type="number" min={1} max={50} className={`${inputClass} mt-1`} value={copies} onChange={(e) => setCopies(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" disabled={busy || !record} onClick={print} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50" data-testid="print-now-button">
          <Printer className="h-4 w-4" aria-hidden="true" /> {busy ? "Printing…" : dirty ? "Save and print" : "Print now"}
        </button>
      </div>
      {result?.ok ? <p role="status" className="text-sm font-semibold text-brand-800">{result.ok}</p> : null}
      {result?.error ? (
        <div role="alert" className="space-y-1 rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-900">
          <p className="font-semibold">{result.error}</p>
          {result.issues?.map((i, n) => (
            <p key={n} className="text-xs">
              {i.message}
              {i.fix ? ` ${i.fix}` : ""}
            </p>
          ))}
        </div>
      ) : null}
      <div className="space-y-1 border-t border-slate-200 pt-3">
        <button type="button" onClick={sample} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 text-sm font-bold text-brand-800 hover:border-brand-500" data-testid="print-sample">
          <Printer className="h-4 w-4" aria-hidden="true" /> Print a sample (works before saving)
        </button>
        <p className="text-xs text-slate-600">Prints this design as it is on screen with example data, to check it on your label stock. Not for labelling product.</p>
      </div>
    </section>
  );
}
