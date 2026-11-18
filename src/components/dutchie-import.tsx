"use client";

import { useRef, useState, useTransition } from "react";
import type { DutchieState } from "@/app/(app)/data/actions";
import type { DutchieResult } from "@/lib/importers/dutchie";
import type { Source } from "@/lib/importers/dutchie-parse";
import { inputClass } from "@/components/ui";

type Act = (formData: FormData) => Promise<DutchieState>;

/**
 * Big exports (a 25,000-row store is about 9 MB) are gzipped in the browser before upload, so they fit
 * through the server's upload limit; a CSV shrinks to about a sixth. The server unzips them.
 */
async function packed(formData: FormData): Promise<FormData> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size < 512 * 1024 || typeof CompressionStream === "undefined") return formData;
  const gz = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  formData.set("file", new File([gz], `${file.name}.gz`, { type: "application/gzip" }));
  return formData;
}

const UPLOAD_FAILED =
  "The upload didn't go through. Check your connection and try again. If the file is very large, export one store or location at a time.";

function Summary({ r, done }: { r: DutchieResult; done: boolean }) {
  return (
    <div className="space-y-3 text-sm" data-testid={done ? "switch-imported" : "switch-preview"}>
      <p className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 font-medium text-brand-900">
        {done ? "Imported" : "Ready to import"}: {r.packages.toLocaleString("en-US")} package{r.packages === 1 ? "" : "s"}, {r.products.created} new product
        {r.products.created === 1 ? "" : "s"}
        {r.products.reused ? ` (${r.products.reused} already in CannaTrace)` : ""}, {r.rooms.created} new room{r.rooms.created === 1 ? "" : "s"}
        {r.labResults ? `, ${r.labResults.toLocaleString("en-US")} lab result${r.labResults === 1 ? "" : "s"}` : ""}.
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
        <summary className="cursor-pointer font-semibold text-brand-700">Which columns were used</summary>
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

const STEPS = {
  dutchie: {
    file: "Dutchie inventory report",
    steps: [
      <>
        In Dutchie Backoffice, open <span className="font-semibold">Reports → Current Inventory</span> (or Products → Inventory) for one store location.
      </>,
      <>Export it to Excel or CSV. Keep the columns you have; CannaTrace finds Product Name, Package ID, Batch, Quantity, Room, and the rest by name.</>,
    ],
  },
  flourish: {
    file: "Flourish package export",
    steps: [
      <>
        In Flourish, open <span className="font-semibold">Inventory → All Packages</span> for one facility. Show the Metrc or state tag, Lot, Area, Quantity, UOM, and Unit Weight columns if they&apos;re hidden.
      </>,
      <>Export it to Excel (or save it as CSV). CannaTrace finds Item Name, Package ID, Lot, Area, Quantity, and the rest by name.</>,
    ],
  },
  nms2s: {
    file: "NMS2S inventory list",
    steps: [
      <>
        In NMS2S, open <span className="font-semibold">Inventory Rooms</span> and choose a room. Under <span className="font-semibold">Manage Columns</span>, show Product
        Name, Strain Name, Total Cannabis weight, Amount Per Unit/Package, Unit/Package Count, and Total THC.
      </>,
      <>
        Put that list in Excel or a CSV with the same column names (ID, Product Type, Product Name, …). Format the ID column as Text first so Excel keeps all 16
        digits. One room per file; add a Room column to bring several at once.
      </>,
    ],
  },
} as const;

/** Upload an inventory export from Dutchie, Flourish, or NMS2S, check it, then import it in one step. */
export function DutchieImport({ preview, run, source = "dutchie" }: { preview: Act; run: Act; source?: Source }) {
  const copy = STEPS[source];
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<DutchieState>(null);
  // The stores a multi-store file names, kept while the same file is checked again with one chosen.
  const [stores, setStores] = useState<{ name: string; rows: number }[]>([]);
  const [pending, start] = useTransition();
  const go = (act: Act) =>
    start(async () => {
      if (!form.current) return;
      let next: DutchieState;
      try {
        next = await act(await packed(new FormData(form.current)));
      } catch {
        // A failed upload (too large, connection dropped) shows a message instead of breaking the page.
        next = { error: UPLOAD_FAILED };
      }
      setState(next);
      if (next?.preview?.stores.length) setStores(next.preview.stores);
    });
  const ready = state?.preview && !state.preview.problems.length && state.preview.packages > 0;
  // Choosing a store isn't something wrong with the file: the picker above asks for it instead of a red box.
  const needsStore = Boolean(state?.preview && stores.length > 1 && state.preview.problems.length === 1 && state.preview.stores.length > 1);
  return (
    <form ref={form} className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <input type="hidden" name="source" value={source} />
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        {copy.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
        <li>Upload it here and press Check. Nothing is saved until you press Import.</li>
      </ol>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-slate-800">{copy.file}</span>
        <input
          name="file"
          type="file"
          required
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-sm"
          onChange={() => {
            setState(null);
            setStores([]);
          }}
        />
      </label>
      {stores.length > 1 ? (
        <label className="block rounded-xl border-2 border-amber-300 bg-amber-50 p-4" data-testid="switch-store-picker">
          <span className="block text-sm font-bold text-amber-950">
            Your file has {stores.length} stores. Pick the one that goes into this facility.
          </span>
          <span className="mb-2 block text-xs text-amber-900">CannaTrace checks it right away. To bring in another store, switch facilities and upload the same file again.</span>
          <select
            name="store"
            defaultValue=""
            data-testid="switch-store"
            className={inputClass}
            disabled={pending}
            onChange={() => {
              setState(null);
              go(preview);
            }}
          >
            <option value="" disabled>
              Choose a store from the file
            </option>
            {stores.map((st) => (
              <option key={st.name} value={st.name}>
                {st.name} ({st.rows.toLocaleString("en-US")} rows)
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
      {state?.preview?.problems.length && !needsStore ? (
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
