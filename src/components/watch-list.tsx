"use client";

import { AlertOctagon, AlertTriangle, Check, ExternalLink, Info, Loader2, MessageCircle, RotateCcw, Wand2, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type WatchItem = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string | null;
  fixLabel: string | null;
  ask: string | null;
  since: string;
};
type Card = { token: string; title: string; details: { label: string; value: string }[]; steps: string[] };
type Fix =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "review"; card: Card }
  | { phase: "working"; card: Card }
  | { phase: "done"; card: Card; result: string; changeId: string | null; undo?: "working" | "done" | "error"; undoMessage?: string };

const LOOK = {
  critical: { icon: AlertOctagon, ring: "border-red-200", chip: "bg-red-100 text-red-800", label: "Urgent" },
  warning: { icon: AlertTriangle, ring: "border-amber-200", chip: "bg-amber-100 text-amber-900", label: "Soon" },
  info: { icon: Info, ring: "border-slate-200", chip: "bg-slate-100 text-slate-700", label: "FYI" },
} as const;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? "That did not go through.");
  return data;
}

/** Tally Watch findings, each with its fix as a plan card: review, approve once, undo if needed. */
export function WatchList({ items, dismiss, sweep }: { items: WatchItem[]; dismiss: (state: null, form: FormData) => Promise<unknown>; sweep: () => Promise<void> }) {
  const router = useRouter();
  const [fixes, setFixes] = useState<Record<string, Fix>>({});
  const [showAll, setShowAll] = useState(false);
  const SHOWN = 6;
  const set = (id: string, fix: Fix) => setFixes((f) => ({ ...f, [id]: fix }));

  const open = async (item: WatchItem) => {
    set(item.id, { phase: "loading" });
    try {
      set(item.id, { phase: "review", card: await post<Card>("/api/watch/fix", { findingId: item.id }) });
    } catch (e) {
      set(item.id, { phase: "error", message: (e as Error).message });
    }
  };
  const confirm = async (item: WatchItem, card: Card) => {
    set(item.id, { phase: "working", card });
    try {
      const r = await post<{ ok: string; changeId: string | null }>("/api/assistant/confirm", { token: card.token });
      set(item.id, { phase: "done", card, result: r.ok, changeId: r.changeId });
    } catch (e) {
      set(item.id, { phase: "error", message: (e as Error).message });
    }
  };
  const undo = async (item: WatchItem, fix: Extract<Fix, { phase: "done" }>) => {
    set(item.id, { ...fix, undo: "working" });
    try {
      const r = await post<{ ok: string }>("/api/assistant/undo", { changeId: fix.changeId });
      set(item.id, { ...fix, undo: "done", undoMessage: r.ok });
    } catch (e) {
      set(item.id, { ...fix, undo: "error", undoMessage: (e as Error).message });
    }
  };
  const ask = (text: string) => window.dispatchEvent(new CustomEvent("open-assistant", { detail: text }));

  if (!items.length)
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-brand-100 bg-brand-50 px-5 py-4 font-semibold text-brand-900">
        <Check className="h-5 w-5" aria-hidden="true" /> All clear. Tally Watch found nothing that needs attention.
      </p>
    );

  return (
    <>
    <ul className="space-y-3" data-watch-list>
      {(showAll ? items : items.slice(0, SHOWN)).map((item) => {
        const look = LOOK[item.severity];
        const Icon = look.icon;
        const fix = fixes[item.id];
        return (
          <li key={item.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${look.ring}`} data-watch-item>
            <div className="flex gap-3">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${item.severity === "critical" ? "text-red-600" : item.severity === "warning" ? "text-amber-600" : "text-slate-500"}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${look.chip}`}>{look.label}</span>
                  <span className="font-semibold text-slate-900">{item.title}</span>
                </p>
                <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                <p className="mt-1 text-xs text-slate-400">Found {item.since}</p>

                {!fix || fix.phase === "error" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.fixLabel ? (
                      <button type="button" onClick={() => open(item)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700">
                        <Wand2 className="h-4 w-4" aria-hidden="true" /> {item.fixLabel}
                      </button>
                    ) : null}
                    {item.ask ? (
                      <button type="button" onClick={() => ask(item.ask!)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-200 px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50">
                        <MessageCircle className="h-4 w-4" aria-hidden="true" /> Ask Tally
                      </button>
                    ) : null}
                    {item.href ? (
                      <Link href={item.href} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open
                      </Link>
                    ) : null}
                    <form
                      action={async (data) => {
                        await dismiss(null, data);
                        router.refresh();
                      }}
                    >
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
                        <X className="h-4 w-4" aria-hidden="true" /> Dismiss
                      </button>
                    </form>
                    {fix?.phase === "error" ? (
                      <p role="alert" className="flex w-full items-start gap-2 text-sm font-medium text-red-700">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {fix.message}
                      </p>
                    ) : null}
                  </div>
                ) : fix.phase === "loading" ? (
                  <p className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Tally is checking the plan against today&apos;s data…
                  </p>
                ) : (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200" data-watch-card>
                    <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{fix.card.title}</p>
                    <dl className="space-y-1.5 px-4 py-3 text-sm">
                      {fix.card.details.map((d, i) => (
                        <div key={i} className="flex justify-between gap-4">
                          <dt className="text-slate-500">{d.label}</dt>
                          <dd className="text-right font-medium text-slate-900">{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {fix.card.steps.length ? (
                      <ol className="list-decimal space-y-1 border-t border-slate-100 py-2 pl-9 pr-4 text-[13px] text-slate-700">
                        {fix.card.steps.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="border-t border-slate-100 px-4 py-3 text-sm">
                      {fix.phase === "review" || fix.phase === "working" ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={fix.phase === "working"}
                            onClick={() => confirm(item, fix.card)}
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
                          >
                            {fix.phase === "working" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />} Confirm
                          </button>
                          <button
                            type="button"
                            disabled={fix.phase === "working"}
                            onClick={() => setFixes((f) => ({ ...f, [item.id]: undefined as unknown as Fix }))}
                            className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className={`flex items-center gap-2 font-medium ${fix.undo === "done" ? "text-slate-500 line-through" : "text-brand-700"}`}>
                            <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> {fix.result}
                          </p>
                          {fix.undo === "done" ? (
                            <p className="flex items-center gap-2 font-medium text-slate-700">
                              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> {fix.undoMessage}
                            </p>
                          ) : fix.undo === "error" ? (
                            <p role="alert" className="flex items-start gap-2 font-medium text-red-700">
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {fix.undoMessage}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {fix.changeId && fix.undo !== "done" ? (
                              <button
                                type="button"
                                disabled={fix.undo === "working"}
                                onClick={() => undo(item, fix)}
                                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                                {fix.undo === "working" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />} Undo this
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={async () => {
                                await sweep();
                                router.refresh();
                              }}
                              className="min-h-9 rounded-lg px-3 font-semibold text-brand-700 hover:bg-brand-50">
                              Refresh the list
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
    {items.length > SHOWN ? (
      <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-semibold text-brand-700 underline underline-offset-2">
        {showAll ? "Show fewer" : `Show all ${items.length}`}
      </button>
    ) : null}
    </>
  );
}
