"use client";

import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, Square, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AttachButton, AttachmentChips, FileGlyph, useAttachments, type SentFile } from "./assistant-attachments";

type Detail = { label: string; value: string };
type ProposalState = "waiting" | "working" | "done" | "cancelled" | "failed";
type UndoState = "ready" | "working" | "done" | "failed";
type Proposal = {
  id: string;
  token: string;
  title: string;
  details: Detail[];
  steps?: string[];
  state: ProposalState;
  result?: string;
  /** Set when the change can be undone in one click. */
  changeId?: string | null;
  undo?: UndoState;
  undoResult?: string;
};
type Turn =
  | { role: "user"; content: string; attachments?: SentFile[] }
  | { role: "assistant"; content: string; status?: string; proposals: Proposal[]; error?: string; streaming?: boolean; stepStart?: number };

const STORAGE_KEY = "cannatrace-assistant";

const md: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="font-medium text-brand-700 underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{children}</code>,
  h1: ({ children }) => <p className="mb-1 mt-3 font-semibold text-slate-900">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-3 font-semibold text-slate-900">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-3 font-semibold text-slate-900">{children}</p>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50 text-slate-600">{children}</thead>,
  th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t border-slate-100 px-3 py-2 tabular-nums">{children}</td>,
};

/** Plain text of the conversation for the server, including what happened to each proposal. */
function transcript(turns: Turn[]) {
  return turns.map((t) =>
    t.role === "user"
      ? { role: "user" as const, content: t.content, ...(t.attachments?.length ? { attachments: t.attachments.map((a) => ({ id: a.id, name: a.name })) } : {}) }
      : {
          role: "assistant" as const,
          content: [
            t.content,
            ...t.proposals.map(
              (p) =>
                `[${p.title}: ${p.details.map((d) => `${d.label} ${d.value}`).join("; ")} — ${p.state === "done" ? `confirmed and done: ${p.result}` : p.state}${p.undo === "done" ? `; then undone: ${p.undoResult}` : ""}]`,
            ),
          ]
            .filter(Boolean)
            .join("\n"),
        },
  );
}

export function AssistantPanel({
  enabled,
  offReason,
  firstName,
  isOwner,
  suggestions,
  retentionHours = 24,
}: {
  enabled: boolean;
  offReason?: string | null;
  firstName: string;
  isOwner: boolean;
  suggestions: string[];
  /** How long attached files are kept, for the notice in the attach menu. */
  retentionHours?: number;
}) {
  const files = useAttachments();
  const [dragging, setDragging] = useState(false);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  // Where keyboard focus was before the panel opened, so closing puts it back.
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      const el = document.activeElement as HTMLElement | null;
      if (el && !panelRef.current?.contains(el)) returnFocus.current = el;
      // On phones the panel covers the screen: keep the page behind it from scrolling.
      if (window.matchMedia("(max-width: 767px)").matches) {
        const html = document.documentElement;
        const before = html.style.overflow;
        html.style.overflow = "hidden";
        return () => {
          html.style.overflow = before;
        };
      }
      return;
    }
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el?.isConnected && panelRef.current?.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [open]);

  // Clicking anywhere outside the panel slides it closed. Buttons that open the assistant are left alone.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || panelRef.current?.contains(target) || target.closest("[data-assistant-trigger]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the conversation while moving between pages and on reload, for this browser tab only.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setTurns((JSON.parse(saved) as Turn[]).map((t) => (t.role === "assistant" ? { ...t, streaming: false, status: undefined } : t)));
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* storage unavailable */
    }
  }, [turns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    const onOpen = (e: Event) => {
      setOpen(true);
      const prompt = (e as CustomEvent<string | undefined>).detail;
      if (prompt) setTimeout(() => window.dispatchEvent(new CustomEvent("assistant-ask", { detail: prompt })), 50);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-assistant", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-assistant", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const updateLast = useCallback((change: (t: Extract<Turn, { role: "assistant" }>) => Extract<Turn, { role: "assistant" }>) => {
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), change(last)];
    });
  }, []);

  const send = async (text: string) => {
    const question = text.trim();
    if (busy || files.uploading || (!question && !files.ready)) return;
    const attached = files.take();
    const history: Turn[] = [...turns, { role: "user", content: question, ...(attached.length ? { attachments: attached } : {}) }];
    setTurns([...history, { role: "assistant", content: "", proposals: [], streaming: true, status: "Thinking" }]);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: transcript(history) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The assistant is unavailable right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "step") updateLast((t) => ({ ...t, stepStart: t.content.length }));
          else if (event.type === "discard") updateLast((t) => ({ ...t, content: t.content.slice(0, t.stepStart ?? 0) }));
          else if (event.type === "text") updateLast((t) => ({ ...t, content: t.content + event.text, status: undefined }));
          else if (event.type === "status") updateLast((t) => ({ ...t, status: event.label }));
          else if (event.type === "proposal")
            updateLast((t) => ({ ...t, status: undefined, proposals: [...t.proposals, { id: event.id, token: event.token, title: event.title, details: event.details, steps: event.steps, state: "waiting" }] }));
          else if (event.type === "error") updateLast((t) => ({ ...t, error: event.message, status: undefined }));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) updateLast((t) => ({ ...t, error: (error as Error).message || "Something went wrong.", status: undefined }));
    } finally {
      updateLast((t) => ({ ...t, streaming: false, status: undefined, content: t.content || (controller.signal.aborted ? "Stopped." : t.content) }));
      setBusy(false);
      abortRef.current = null;
    }
  };

  // Buttons elsewhere on the page can ask a question through an "assistant-ask" event.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    // Asking from elsewhere (a Tally Watch item, say) also opens the panel, so the answer is seen.
    const onAsk = (e: Event) => {
      setOpen(true);
      sendRef.current(String((e as CustomEvent<string>).detail ?? ""));
    };
    window.addEventListener("assistant-ask", onAsk);
    return () => window.removeEventListener("assistant-ask", onAsk);
  }, []);

  const setProposal = (id: string, change: Partial<Proposal>) =>
    setTurns((prev) =>
      prev.map((t) => (t.role === "assistant" && t.proposals.some((p) => p.id === id) ? { ...t, proposals: t.proposals.map((p) => (p.id === id ? { ...p, ...change } : p)) } : t)),
    );

  const confirm = async (p: Proposal) => {
    setProposal(p.id, { state: "working" });
    try {
      const res = await fetch("/api/assistant/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: p.token }) });
      const body = (await res.json()) as { ok?: string; error?: string; changeId?: string | null };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "That did not go through.");
      setProposal(p.id, { state: "done", result: body.ok, changeId: body.changeId ?? null, undo: body.changeId ? "ready" : undefined });
      router.refresh();
    } catch (error) {
      setProposal(p.id, { state: "failed", result: (error as Error).message });
    }
  };

  const undo = async (p: Proposal) => {
    if (!p.changeId) return;
    setProposal(p.id, { undo: "working" });
    try {
      const res = await fetch("/api/assistant/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId: p.changeId }) });
      const body = (await res.json()) as { ok?: string; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "The undo did not go through.");
      setProposal(p.id, { undo: "done", undoResult: body.ok });
      router.refresh();
    } catch (error) {
      setProposal(p.id, { undo: "failed", undoResult: (error as Error).message });
    }
  };

  const last = turns[turns.length - 1];

  return (
    <>
      <button
        type="button"
        data-assistant-trigger
        onClick={() => setOpen(true)}
        aria-label="Ask Tally"
        data-testid="tally-launcher"
        // Bottom-right of the screen, above the phone tab bar, clear of the iPhone home bar and notch.
        className={`fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-900 text-white shadow-lg shadow-brand-900/30 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] md:right-[calc(1.5rem+env(safe-area-inset-right))] print:hidden ${open ? "pointer-events-none scale-75 opacity-0" : ""}`}
      >
        <Sparkles className="h-6 w-6" aria-hidden="true" />
      </button>

      <div
        className={`fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px] transition-opacity md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Tally, the CannaTrace assistant"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col overscroll-contain border-l border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl transition-[transform,visibility] duration-300 ease-out sm:w-[440px] print:hidden ${open ? "visible translate-x-0" : "invisible translate-x-full"}`}
        onDragOver={(e) => {
          if (!enabled || busy || !Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          setDragging(false);
          const dropped = Array.from(e.dataTransfer.files ?? []);
          if (!dropped.length || !enabled || busy) return;
          e.preventDefault();
          files.add(dropped);
        }}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tally-avatar.webp" alt="" width={40} height={40} className="h-10 w-10 rounded-xl border border-brand-100 bg-white" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              Tally <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">Claude</span>
            </p>
            <p className="text-xs text-slate-500">Your CannaTrace assistant · answers from live data</p>
          </div>
          {turns.length ? (
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                setTurns([]);
              }}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="New conversation"
              title="New conversation"
            >
              <RotateCcw className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Close assistant">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
          {!enabled ? (
            <div className="mt-10 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-brand-200" aria-hidden="true" />
              <p className="mt-3 font-semibold text-slate-900">{offReason === "PAUSED" ? "Tally is paused" : "Tally isn't connected yet"}</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-slate-600">
                {offReason === "PAUSED"
                  ? isOwner
                    ? "Turn it back on in Settings → Tally AI."
                    : "An owner paused Tally for this business."
                  : isOwner
                    ? "Tally runs on your business's own Claude account. Connecting takes about five minutes."
                    : "Tally runs on your business's own Claude account. Ask an owner to connect it in Settings → Tally AI."}
              </p>
              {isOwner ? (
                <a href="/settings/ai" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800">
                  Set up Tally AI
                </a>
              ) : null}
            </div>
          ) : turns.length === 0 ? (
            <div className="mt-6">
              <p className="text-xl font-semibold tracking-tight text-slate-900">Hi {firstName}, what can I help with?</p>
              <p className="mt-1 text-sm text-slate-600">Ask about inventory, sales, plants, orders, or state reporting. I can also receive packages, start orders and production runs, close out harvests, and fix quantities. You approve the plan once, and every change has an Undo.</p>
              <div className="mt-5 grid gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-xl border border-slate-200 px-4 py-3 text-left text-sm text-slate-800 transition hover:border-brand-500 hover:bg-brand-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="space-y-5">
              {turns.map((turn, i) =>
                turn.role === "user" ? (
                  <li key={i} className="flex flex-col items-end gap-1.5">
                    {turn.attachments?.length ? (
                      <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5" aria-label="Files sent">
                        {turn.attachments.map((a) => (
                          <li key={a.id} className="flex max-w-full items-center gap-1.5 rounded-lg border border-brand-100 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-900" data-sent-file>
                            <FileGlyph group={a.kind} className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{a.name}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {turn.content ? <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-sm text-white">{turn.content}</p> : null}
                  </li>
                ) : (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-900 text-white">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 text-sm leading-relaxed text-slate-700">
                      {turn.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
                          {turn.content}
                        </ReactMarkdown>
                      ) : null}
                      {turn.status ? (
                        <p className="mt-1 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600" role="status">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          {turn.status}…
                        </p>
                      ) : null}
                      {turn.proposals.map((p) => (
                        <div key={p.id} className="mt-3 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                          <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{p.title}</p>
                          <dl className="space-y-1.5 px-4 py-3">
                            {p.details.map((d) => (
                              <div key={d.label} className="flex justify-between gap-4">
                                <dt className="text-slate-500">{d.label}</dt>
                                <dd className="text-right font-medium text-slate-900">{d.value}</dd>
                              </div>
                            ))}
                          </dl>
                          {p.steps?.length ? (
                            <details className="border-t border-slate-100 px-4 py-2" open={p.steps.length <= 8}>
                              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">The plan · {p.steps.length} step{p.steps.length === 1 ? "" : "s"}</summary>
                              <ol className="mt-2 max-h-56 list-decimal space-y-1 overflow-y-auto pl-5 text-[13px] text-slate-700" data-plan-steps>
                                {p.steps.map((step, i) => (
                                  <li key={i}>{step}</li>
                                ))}
                              </ol>
                            </details>
                          ) : null}
                          <div className="border-t border-slate-100 px-4 py-3">
                            {p.state === "waiting" || p.state === "working" ? (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={p.state === "working"}
                                  onClick={() => confirm(p)}
                                  className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
                                >
                                  {p.state === "working" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  disabled={p.state === "working"}
                                  onClick={() => setProposal(p.id, { state: "cancelled" })}
                                  className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : p.state === "done" ? (
                              <div className="space-y-2">
                                <p className={`flex items-center gap-2 font-medium ${p.undo === "done" ? "text-slate-500 line-through" : "text-brand-700"}`}>
                                  <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> {p.result}
                                </p>
                                {p.undo === "ready" || p.undo === "working" ? (
                                  <button
                                    type="button"
                                    disabled={p.undo === "working"}
                                    onClick={() => undo(p)}
                                    className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                  >
                                    {p.undo === "working" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                                    Undo this
                                  </button>
                                ) : p.undo === "done" ? (
                                  <p className="flex items-center gap-2 font-medium text-slate-700">
                                    <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> {p.undoResult}
                                  </p>
                                ) : p.undo === "failed" ? (
                                  <div className="space-y-2">
                                    <p className="flex items-start gap-2 font-medium text-red-700">
                                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {p.undoResult}
                                    </p>
                                    <button type="button" onClick={() => undo(p)} className="text-sm font-semibold text-brand-700 underline underline-offset-2">
                                      Try undo again
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : p.state === "failed" ? (
                              <p className="flex items-center gap-2 font-medium text-red-700">
                                <XCircle className="h-4 w-4" aria-hidden="true" /> {p.result}
                              </p>
                            ) : (
                              <p className="text-slate-500">Cancelled. Nothing was changed.</p>
                            )}
                          </div>
                        </div>
                      ))}
                      {turn.error ? (
                        <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                          {turn.error}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>

        <form
          className="border-t border-slate-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <AttachmentChips items={files.items} notice={files.notice} onRemove={files.remove} />
          <div className="flex items-end gap-1 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600">
            <AttachButton disabled={!enabled || busy} onFiles={files.add} retentionHours={retentionHours} />
            <textarea
              ref={inputRef}
              value={draft}
              disabled={!enabled}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              onPaste={(e) => {
                // A pasted screenshot (or copied files) become attachments; pasted text stays text.
                const pasted = Array.from(e.clipboardData.files ?? []);
                if (pasted.length && enabled && !busy) {
                  e.preventDefault();
                  files.add(pasted);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder={enabled ? "Ask anything about your business…" : "Not turned on yet"}
              aria-label="Message the assistant"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-white" aria-label="Stop">
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!enabled || files.uploading || (!draft.trim() && !files.ready)}
                title={files.uploading ? "Waiting for files to finish uploading" : undefined}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-700 text-white transition hover:bg-brand-800 disabled:bg-slate-200 disabled:text-slate-400"
                aria-label="Send"
              >
                <ArrowUp className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            {last?.role === "assistant" && last.streaming
              ? "Working on it…"
              : files.uploading
                ? "Uploading files…"
                : "Claude can make mistakes. Changes always wait for your Confirm."}
          </p>
        </form>
        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-500 bg-brand-50/90 text-center" aria-hidden="true">
            <p className="text-sm font-semibold text-brand-800">
              Drop files to attach
              <span className="block text-xs font-normal text-brand-700">Images, PDFs, spreadsheets, and documents</span>
            </p>
          </div>
        ) : null}
      </aside>
    </>
  );
}

/** A button anywhere on the page that opens the assistant. */
export function AskButton() {
  return (
    <button
      type="button"
      data-assistant-trigger
      onClick={() => window.dispatchEvent(new Event("open-assistant"))}
      className="hidden min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-500 md:inline-flex"
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      Ask Tally
      <kbd className="rounded bg-white/15 px-1.5 text-[10px] font-semibold text-white">Ctrl J</kbd>
    </button>
  );
}

/** A button that opens the assistant and asks it something about the page. */
export function AskAboutButton({ prompt, label }: { prompt: string; label: string }) {
  return (
    <button
      type="button"
      data-assistant-trigger
      onClick={() => window.dispatchEvent(new CustomEvent("open-assistant", { detail: prompt }))}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-800 transition hover:border-brand-500"
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
