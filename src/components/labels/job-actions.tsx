"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export const newRequestKey = () => crypto.randomUUID().replace(/-/g, "");

/**
 * Build the job's PDF and send it straight to the browser's print dialog through a hidden frame.
 * Errors come back as a message instead of an error page.
 */
export async function printJobPdf(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/labels/jobs/${id}/pdf`);
  if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error ?? "The labels could not be made." };
  const url = URL.createObjectURL(await res.blob());
  document.getElementById("label-print-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "label-print-frame";
  frame.title = "Labels to print";
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url;
  frame.onload = () => {
    // Give the PDF viewer a moment to lay out the pages, and the screen a moment to update, before printing.
    setTimeout(() => {
      // Automated tests set this list instead of opening a real print dialog (headless browsers can't show one).
      const testHook = (window as unknown as { __labelPrints?: string[] }).__labelPrints;
      if (testHook) return void testHook.push(id);
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        // Some browsers won't print a PDF from a frame; open it so the person can print from there.
        window.open(url, "_blank");
      }
    }, 500);
  };
  document.body.appendChild(frame);
  return { ok: true };
}

const btn = "inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-bold transition disabled:opacity-50";

/** What a person can do with a print job. PDF opening counts as an attempt; "It printed" is their confirmation. */
/** `blocked` jobs failed the checks before any PDF was made; retrying can't help, so only Cancel is offered. */
export function JobActions({ id, status: initial, blocked }: { id: string; status: string; blocked?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reprintKey] = useState(newRequestKey);
  const [note, setNote] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      router.refresh();
      return data;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Fetch first so a problem shows here as a message, not as an error page in a new tab. */
  async function openPdf() {
    setError(null);
    const win = window.open("", "_blank");
    setBusy(true);
    try {
      const res = await fetch(`/api/labels/jobs/${id}/pdf`);
      if (!res.ok) {
        setStatus("FAILED");
        throw new Error((await res.json().catch(() => ({}))).error ?? "The labels could not be made.");
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.location.href = url;
      if (status !== "PRINTED") setStatus("RENDERED");
    } catch (e) {
      win?.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function print() {
    setBusy(true);
    setError(null);
    try {
      const r = await printJobPdf(id);
      if (!r.ok) {
        setStatus("FAILED");
        throw new Error(r.error);
      }
      if (status !== "PRINTED") setStatus("RENDERED");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const open = status !== "CANCELLED" && !(blocked && status === "FAILED");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {open ? (
        <>
          <button type="button" disabled={busy} onClick={print} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
            {status === "FAILED" ? "Try printing again" : status === "PRINTED" ? "Print again" : "Print"}
          </button>
          <button type="button" disabled={busy} onClick={openPdf} className={`${btn} border border-brand-300 bg-white text-brand-800 hover:border-brand-600`}>
            Open PDF
          </button>
        </>
      ) : null}
      {status === "RENDERED" ? (
        <>
          <button type="button" disabled={busy} onClick={async () => (await post(`/api/labels/jobs/${id}/status`, { status: "PRINTED" })) && setStatus("PRINTED")} className={`${btn} border border-brand-300 bg-white text-brand-800 hover:border-brand-600`}>
            It printed
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const note = window.prompt("What went wrong? (jammed, wrong size, smudged…)") ?? "";
              void post(`/api/labels/jobs/${id}/status`, { status: "FAILED", note }).then((ok) => ok && setStatus("FAILED"));
            }}
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:border-slate-500`}
          >
            Didn&apos;t print
          </button>
        </>
      ) : null}
      {status === "PRINTED" ? (
        <button type="button" disabled={busy} onClick={async () => {
            const data = await post(`/api/labels/jobs/${id}/reprint`, { idempotencyKey: reprintKey });
            if (data) setNote(data.duplicate ? "Reprint already started; see the queue." : `Reprint queued: ${data.job.labelCount} label${data.job.labelCount === 1 ? "" : "s"}. Open it from the Print queue.`);
          }} className={`${btn} border border-brand-300 bg-white text-brand-800 hover:border-brand-600`}>
          Reprint
        </button>
      ) : null}
      {status === "QUEUED" || status === "FAILED" ? (
        <button type="button" disabled={busy} onClick={async () => (await post(`/api/labels/jobs/${id}/status`, { status: "CANCELLED" })) && setStatus("CANCELLED")} className={`${btn} text-slate-600 hover:text-slate-900`}>
          Cancel
        </button>
      ) : null}
      {status === "CANCELLED" ? <span className="text-xs font-semibold text-slate-500">Cancelled</span> : null}
      {note ? <span role="status" className="text-xs font-semibold text-brand-800">{note}</span> : null}
      {error ? <span role="alert" className="text-xs font-semibold text-red-700">{error}</span> : null}
    </div>
  );
}
