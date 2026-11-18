"use client";

import { AlertTriangle, Boxes, CheckCircle2, FlaskConical, MessageCircleQuestion, Send, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

const ask = (prompt: string) => window.dispatchEvent(new CustomEvent("open-assistant", { detail: prompt }));

const ICONS = {
  up: { icon: TrendingUp, tone: "text-brand-600" },
  down: { icon: TrendingDown, tone: "text-amber-600" },
  packages: { icon: Boxes, tone: "text-brand-600" },
  production: { icon: FlaskConical, tone: "text-brand-600" },
  alert: { icon: AlertTriangle, tone: "text-red-600" },
  ok: { icon: CheckCircle2, tone: "text-brand-600" },
};

export type Takeaway = { icon: keyof typeof ICONS; text: string };

/** Tally on the Command Center: a summary of the numbers, and questions that open Tally already asking them. */
export function TallyDock({ name, summary, takeaways, prompts }: { name: string; summary: string; takeaways: Takeaway[]; prompts: string[] }) {
  const [text, setText] = useState("");
  return (
    <aside aria-label="Tally assistant" className="flex flex-col rounded-2xl border border-brand-100 bg-white p-5 shadow-sm" data-testid="tally-dock">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="flex items-center gap-2 font-extrabold text-brand-950">
            Tally Assistant <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200">AI</span>
          </p>
          <p className="text-xs text-slate-500">Powered by your live data</p>
        </div>
      </div>
      <h2 className="mt-5 text-lg font-extrabold leading-snug text-brand-950">Hi {name}, here&apos;s your operations summary.</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary}</p>
      <h3 className="mt-5 text-sm font-bold text-slate-900">Top takeaways</h3>
      <ul className="mt-2 space-y-2">
        {takeaways.map((t) => {
          const { icon: Icon, tone } = ICONS[t.icon];
          return (
            <li key={t.text} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-sm font-medium text-slate-800">
              <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
              {t.text}
            </li>
          );
        })}
      </ul>
      <h3 className="mt-5 text-sm font-bold text-slate-900">How can I help next?</h3>
      <ul className="mt-2 space-y-2">
        {prompts.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => ask(p)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:bg-brand-50"
            >
              <MessageCircleQuestion className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
              {p}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-5 flex items-center gap-2 rounded-xl border border-slate-200 p-1.5 focus-within:border-brand-500"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          ask(text.trim());
          setText("");
        }}
      >
        <label htmlFor="dock-ask" className="sr-only">
          Ask Tally
        </label>
        <input
          id="dock-ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask anything about your operations…"
          className="min-h-9 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-slate-400"
        />
        <button type="submit" aria-label="Ask Tally" className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white hover:bg-brand-800">
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      <p className="mt-2 text-center text-xs text-slate-500">Tally can look up your data, find issues, and take action after you confirm.</p>
    </aside>
  );
}
