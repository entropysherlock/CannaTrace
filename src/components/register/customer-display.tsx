"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LeafMark } from "@/components/logo";
import { money } from "./pay-panel";

export type DisplayView =
  | { store: string; state: "welcome" }
  | { store: string; state: "thanks"; total: string; change: string }
  | {
      store: string;
      state: "cart";
      lines: { id: string; name: string; quantity: string; total: string }[];
      discount: string | null;
      taxes: string;
      total: string;
    };

const $ = (v: string) => money(Math.round(Number(v) * 100));

/** Full-window, read-only, and refreshed every two seconds, for a second monitor or tablet facing the counter. */
export function CustomerDisplay({ view }: { view: DisplayView }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-brand-950 text-white">
      <header className="flex items-center gap-3 px-8 py-6">
        <LeafMark className="h-10 w-10 text-brand-200" />
        <span className="font-display text-2xl font-bold">{view.store}</span>
      </header>
      {view.state === "welcome" ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="font-display text-6xl font-bold tracking-tight">Welcome</p>
          <p className="mt-4 text-2xl text-brand-200">Have your ID ready, please.</p>
        </div>
      ) : view.state === "thanks" ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center" role="status">
          <p className="font-display text-6xl font-bold tracking-tight">Thank you!</p>
          <p className="mt-4 text-3xl text-brand-100">Paid {$(view.total)}</p>
          {Number(view.change) > 0 ? <p className="mt-2 font-display text-5xl font-bold text-amber-300">Your change: {$(view.change)}</p> : null}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-6 px-8 pb-8 lg:grid-cols-[1fr_minmax(320px,40%)]">
          <ul className="min-h-0 space-y-2 overflow-y-auto rounded-3xl bg-white/5 p-5" aria-label="Your items">
            {view.lines.length === 0 ? <li className="text-2xl text-brand-200">Your items will appear here.</li> : null}
            {view.lines.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-4 border-b border-white/10 py-3 text-2xl">
                <span>
                  <span className="mr-3 tabular-nums text-brand-200">{l.quantity}×</span>
                  {l.name}
                </span>
                <span className="tabular-nums">{$(l.total)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col justify-end rounded-3xl bg-white p-8 text-brand-950">
            {view.discount ? (
              <p className="flex justify-between text-2xl">
                <span>Discount</span>
                <span className="tabular-nums">-{$(view.discount)}</span>
              </p>
            ) : null}
            <p className="flex justify-between text-2xl text-slate-600">
              <span>Taxes</span>
              <span className="tabular-nums">{$(view.taxes)}</span>
            </p>
            <p className="mt-4 text-xl font-semibold text-slate-600">Total</p>
            <p className="font-display text-7xl font-bold tabular-nums tracking-tight">{$(view.total)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
