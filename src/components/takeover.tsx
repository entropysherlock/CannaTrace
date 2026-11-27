"use client";

import { Hand, Loader2, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ELEMENTS, MAX_STEPS, checkAction, type Action, type PageElement } from "@/lib/takeover-math";

const KEY = "leaf2sale-takeover";
type Saved = { goal: string; history: { action: Action; result: string }[]; running: boolean };
type Phase = "idle" | "thinking" | "acting" | "stopped";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function labelOf(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const aria = el.getAttribute("aria-label") || el.getAttribute("title");
  if (aria) return aria.trim();
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l?.textContent) return l.textContent.trim();
  }
  const wrap = el.closest("label");
  if (wrap?.textContent && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return wrap.textContent.trim().replace(/\s+/g, " ");
  if (["INPUT", "TEXTAREA"].includes(el.tagName)) return input.placeholder || input.name || el.tagName.toLowerCase();
  if (el.tagName === "SELECT") return (el as HTMLSelectElement).name || "dropdown";
  return (el.textContent || "").trim().replace(/\s+/g, " ");
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none";
}

function snapshot(): PageElement[] {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,summary,[role=button]")).filter((el) => !el.closest("[data-takeover-ignore]") && visible(el) && (el as HTMLInputElement).type !== "hidden");
  const out: PageElement[] = [];
  nodes.slice(0, MAX_ELEMENTS).forEach((el, i) => {
    el.setAttribute("data-tk", String(i));
    const input = el as HTMLInputElement;
    const tag = el.tagName.toLowerCase();
    out.push({
      i,
      tag: tag === "div" ? "button" : tag,
      label: labelOf(el).slice(0, 100),
      type: tag === "input" ? input.type : undefined,
      value: ["input", "textarea", "select"].includes(tag) && input.type !== "password" ? (tag === "select" ? (el as HTMLSelectElement).selectedOptions[0]?.text : input.value) || undefined : undefined,
      href: tag === "a" ? (el as HTMLAnchorElement).getAttribute("href") ?? undefined : undefined,
      options: tag === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => o.text) : undefined,
      disabled: input.disabled || el.getAttribute("aria-disabled") === "true",
    });
  });
  return out;
}

function setNative(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
}

export function Takeover() {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [final, setFinal] = useState<{ tone: "ok" | "ask" | "err"; text: string } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; ripple: number } | null>(null);
  const stop = useRef(false);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const save = (s: Saved | null) => {
    try {
      if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
      else sessionStorage.removeItem(KEY);
    } catch {}
  };

  const moveTo = useCallback(async (el: HTMLElement) => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(350);
    const r = el.getBoundingClientRect();
    setCursor((c) => ({ x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2, ripple: c?.ripple ?? 0 }));
    await sleep(750);
  }, []);

  const perform = useCallback(
    async (action: Action): Promise<string> => {
      const find = (i: number) => document.querySelector<HTMLElement>(`[data-tk="${i}"]`);
      if (action.type === "wait") {
        await sleep(1200);
        return "waited";
      }
      if (action.type === "scroll") {
        window.scrollBy({ top: (action.direction === "up" ? -1 : 1) * window.innerHeight * 0.7, behavior: "smooth" });
        await sleep(600);
        return "scrolled";
      }
      if (action.type === "navigate") {
        window.history.pushState(null, "", action.path);
        window.location.assign(action.path);
        await sleep(1500);
        return `went to ${action.path}`;
      }
      if (action.type !== "click" && action.type !== "type" && action.type !== "select") return "ok";
      const el = find(action.i);
      if (!el) return "that control was gone";
      await moveTo(el);
      if (action.type === "click") {
        setCursor((c) => (c ? { ...c, ripple: c.ripple + 1 } : c));
        await sleep(220);
        el.click();
        return `clicked "${labelOf(el).slice(0, 40)}"`;
      }
      if (action.type === "select") {
        const sel = el as HTMLSelectElement;
        const want = action.value.toLowerCase();
        const opt = Array.from(sel.options).find((o) => o.text.toLowerCase() === want) ?? Array.from(sel.options).find((o) => o.text.toLowerCase().includes(want) || o.value.toLowerCase() === want);
        if (!opt) return `no option like "${action.value}"`;
        setCursor((c) => (c ? { ...c, ripple: c.ripple + 1 } : c));
        await sleep(300);
        setNative(sel, opt.value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return `picked "${opt.text}"`;
      }
      const box = el as HTMLInputElement;
      setCursor((c) => (c ? { ...c, ripple: c.ripple + 1 } : c));
      box.focus();
      setNative(box, "");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      let typed = "";
      for (const ch of action.text) {
        if (stop.current) break;
        typed += ch;
        setNative(box, typed);
        box.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(45);
      }
      box.dispatchEvent(new Event("change", { bubbles: true }));
      if (action.submit) box.form?.requestSubmit();
      return `typed "${typed.slice(0, 40)}"`;
    },
    [moveTo],
  );

  const finish = useCallback(async (g: string, outcome: "DONE" | "BLOCKED" | "FAILED", summary: string) => {
    setPhase("idle");
    setCursor(null);
    save(null);
    await fetch("/api/takeover/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal: g, finish: { outcome, summary } }) }).catch(() => {});
  }, []);

  const loop = useCallback(
    async (state: Saved) => {
      if (busy.current) return;
      busy.current = true;
      stop.current = false;
      setFinal(null);
      try {
        while (!stop.current) {
          if (state.history.length >= MAX_STEPS) {
            setFinal({ tone: "ask", text: "I took a lot of steps without finishing. Tell me how to continue." });
            await finish(state.goal, "BLOCKED", "Stopped after too many steps.");
            return;
          }
          setPhase("thinking");
          await sleep(500); // let the page settle
          const elements = snapshot();
          abort.current = new AbortController();
          const res = await fetch("/api/takeover/step", {
            method: "POST",
            signal: abort.current.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ goal: state.goal, history: state.history.slice(-30), page: { url: location.pathname + location.search, title: document.title, text: (document.querySelector("main")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 1500), elements } }),
          }).catch(() => null);
          if (stop.current) break;
          const data = res ? await res.json().catch(() => ({})) : {};
          if (!res || !res.ok || !data.action) {
            setFinal({ tone: "err", text: data.error ?? "I couldn't reach Tally. Try again in a moment." });
            await finish(state.goal, "FAILED", data.error ?? "Could not reach Tally.");
            return;
          }
          const action = data.action as Action;
          if (action.type === "done") {
            setFinal({ tone: "ok", text: action.message });
            await finish(state.goal, "DONE", action.message);
            return;
          }
          if (action.type === "ask") {
            setFinal({ tone: "ask", text: action.message });
            await finish(state.goal, "BLOCKED", action.message);
            return;
          }
          const checked = checkAction(action, elements);
          if ("stop" in checked) {
            setFinal({ tone: "ask", text: checked.stop });
            await finish(state.goal, "BLOCKED", checked.stop);
            return;
          }
          setPhase("acting");
          const result = await perform(checked.action);
          state = { ...state, history: [...state.history, { action: checked.action, result }] };
          setLog((l) => [...l.slice(-8), result]);
          save({ ...state, running: true });
          await sleep(700);
        }
      } finally {
        busy.current = false;
        if (stop.current) {
          setPhase("stopped");
          setCursor(null);
          save(null);
        }
      }
    },
    [finish, perform],
  );

  // Pick up where we left off after a full page load.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Saved;
      if (s.running)
        queueMicrotask(() => {
          setGoal(s.goal);
          setOpen(true);
          void loop(s);
        });
    } catch {}
  }, [loop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy.current) halt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function halt() {
    stop.current = true;
    abort.current?.abort();
    setPhase("stopped");
    setCursor(null);
    save(null);
  }

  function start() {
    const g = goal.trim();
    if (!g || busy.current) return;
    setLog([]);
    const s: Saved = { goal: g, history: [], running: true };
    save(s);
    void loop(s);
  }

  const running = phase === "thinking" || phase === "acting";

  return (
    <div data-takeover-ignore className="print:hidden">
      {cursor && (
        <div className="pointer-events-none fixed left-0 top-0 z-[100] transition-transform duration-700 ease-out" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
          <span key={cursor.ripple} className={`absolute -left-4 -top-4 h-8 w-8 rounded-full border-2 border-brand-500 ${cursor.ripple ? "animate-ping" : "opacity-0"}`} />
          <svg width="26" height="26" viewBox="0 0 24 24" className="drop-shadow-md" aria-hidden>
            <path d="M3 2l7 19 3-8 8-3z" fill="#16a34a" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {running && <div className="pointer-events-none fixed inset-0 z-[90] ring-4 ring-inset ring-brand-500/60" />}
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-4 z-30 flex h-12 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-brand-800 shadow-lg ring-1 ring-slate-200 hover:bg-brand-50 md:bottom-6">
          <Hand className="h-4 w-4" /> Take over
        </button>
      )}
      {open && (
        <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-4 z-[95] w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-200 md:bottom-6">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Hand className="h-4 w-4 text-brand-700" /> Take over</p>
            <button type="button" aria-label="Close" onClick={() => { if (running) halt(); setOpen(false); }} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
          {!running && (
            <>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} placeholder="Tell me what to do, like: make 2 batches of the gummies in the Finished room" className="mt-3 w-full rounded-lg border border-slate-300 p-2 text-sm" />
              <button type="button" onClick={start} disabled={!goal.trim()} className="mt-2 w-full rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">Start</button>
              <p className="mt-2 text-xs text-slate-500">I&apos;ll move the cursor and click and type for you. I stop and hand back anything that deletes, disconnects or moves money. Press Esc to stop me anytime.</p>
            </>
          )}
          {running && (
            <div className="mt-3">
              <p className="flex items-center gap-2 text-sm text-slate-700"><Loader2 className="h-4 w-4 animate-spin text-brand-700" /> {phase === "thinking" ? "Looking at the screen…" : "Working…"}</p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{goal}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-500">{log.slice(-4).map((l, i) => <li key={i}>• {l}</li>)}</ul>
              <button type="button" onClick={halt} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"><Square className="h-3.5 w-3.5" /> Stop</button>
            </div>
          )}
          {!running && phase === "stopped" && <p className="mt-2 text-sm text-slate-600">Stopped.</p>}
          {!running && final && <p className={`mt-3 rounded-lg p-2 text-sm ${final.tone === "ok" ? "bg-brand-50 text-brand-900" : final.tone === "ask" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}>{final.text}</p>}
        </div>
      )}
    </div>
  );
}
