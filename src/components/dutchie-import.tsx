"use client";

import { useRef, useState, useTransition } from "react";
import type { DutchieState } from "@/app/(app)/data/actions";
import type { DutchieResult } from "@/lib/importers/dutchie";

type Act = (formData: FormData) => Promise<DutchieState>;

function Summary({ r, done }: { r: DutchieResult; done: boolean }) {
  return (
    <div className="space-y-3 text-sm" data-testid={done ? "dutchie-imported" : "dutchie-preview"}>
      <p className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 font-medium text-brand-900">
        {done ? "Imported" : "Ready to import"}: {r.packages.toLocaleString("en-US")} package{r.packages === 1 ? "" : "s"}, {r.products.created} new product
        {r.products.created === 1 ? "" : "s"}
        {r.products.reused ? ` (${r.products.reused} already in CannaTrace)` : ""}, {r.rooms.created} new room{r.rooms.created === 1 ? "" : "s"}
        {r.labResults ? `, ${r.labResults} pending lab result${r.labResults === 1 ? "" : "s"}` : ""}.
      </p>
      {r.warnings.length ? (
        <ul className="list-disc space-y-1 pl-5 text-amber-800">
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {r.sample.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-3">Tag</th>
                <th className="py-1 pr-3">Product</th>
                <th className="py-1 pr-3">Quantity</th>
                <th className="py-1">Room</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.sample.map((s, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3 font-mono">{s.tag}</td>
                  <td className="py-1 pr-3">{s.product}</td>
                  <td className="py-1 pr-3">{s.quantity}</td>
                  <td className="py-1">{s.room}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.packages > r.sample.length ? <p className="mt-1 text-xs text-slate-500">…and {(r.packages - r.sample.length).toLocaleString("en-US")} more.</p> : null}
        </div>
      ) : null}
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-brand-700">Which Dutchie columns were used</summary>
        <ul className="mt-1 space-y-0.5">
          {r.matched.map((m) => (
            <li key={m.field}>
              {m.field} ← <span className="font-mono">{m.column}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Upload a Dutchie inventory report, check it, then import it in one step. */
export function DutchieImport({ preview, run }: { preview: Act; run: Act }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<DutchieState>(null);
  const [pending, start] = useTransition();
  const go = (act: Act) =>
    start(async () => {
      if (!form.current) return;
      setState(await act(new FormData(form.current)));
    });
  const ready = state?.preview && !state.preview.problems.length && state.preview.packages > 0;
  return (
    <form ref={form} className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>
          In Dutchie Backoffice, open <span className="font-semibold">Reports → Current Inventory</span> (or Products → Inventory) for one store location.
        </li>
        <li>Export it to Excel or CSV. Keep the columns you have; CannaTrace finds Product Name, Package ID, Batch, Quantity, Room, and the rest by name.</li>
        <li>Upload it here and press Check. Nothing is saved until you press Import.</li>
      </ol>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-800">Dutchie inventory report</span>
        <input
          name="file"
          type="file"
          required
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-sm"
          onChange={() => setState(null)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => go(preview)}
          className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand-200 bg-white px-5 text-sm font-bold text-brand-800 hover:border-brand-500 disabled:opacity-60"
        >
          {pending && !ready ? "Checking…" : "Check the file"}
        </button>
        {ready ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => go(run)}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? "Importing…" : `Import ${state!.preview!.packages.toLocaleString("en-US")} packages`}
          </button>
        ) : null}
      </div>
      {state?.error ? (
        <p role="alert" className="whitespace-pre-line rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          {state.error}
        </p>
      ) : null}
      {state?.preview?.problems.length ? (
        <div role="alert" className="rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-900">
          <p className="font-semibold">Fix these in the file, then check it again. Nothing was saved.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {state.preview.problems.slice(0, 20).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {state?.imported ? <Summary r={state.imported} done /> : state?.preview && !state.preview.problems.length ? <Summary r={state.preview} done={false} /> : null}
    </form>
  );
}
