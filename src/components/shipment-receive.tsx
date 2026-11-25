"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { ShipmentState } from "@/app/(app)/inventory/actions";
import { packed, TooBig } from "@/components/dutchie-import";
import { CreatableSelect, type CreateConfig } from "@/components/contextual-create";
import { inputClass } from "@/components/ui";
import type { Received } from "@/lib/shipments-parse";

type Act = (formData: FormData) => Promise<ShipmentState>;
type Option = { id: string; name: string };

const STATUS = {
  MATCH: { text: "Arrived", tone: "bg-emerald-100 text-emerald-800" },
  SHORT: { text: "Short", tone: "bg-amber-100 text-amber-900" },
  MISSING: { text: "Didn't arrive", tone: "bg-red-100 text-red-800" },
} as const;

/** Upload a manifest, count what arrived, explain any difference, then receive it all in one step. */
export function ShipmentReceive({
  check,
  receive,
  locations,
  vendors,
  addLocation,
  addVendor,
}: {
  check: Act;
  receive: Act;
  locations: Option[];
  vendors: Option[];
  /** Set when this person may add locations, so a missing one is added without leaving the shipment. */
  addLocation?: CreateConfig;
  /** Set when this person may add vendors (sales), through the guided vendor drawer. */
  addVendor?: CreateConfig;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ShipmentState>(null);
  // What the receiver counted, by tag. Lines left alone arrived as listed.
  const [counts, setCounts] = useState<Record<string, Received>>({});
  const [pending, start] = useTransition();
  const go = (act: Act) =>
    start(async () => {
      if (!form.current) return;
      const data = new FormData(form.current);
      data.set("received", JSON.stringify(counts));
      try {
        setState(await act(await packed(data)));
      } catch (error) {
        setState({ error: error instanceof TooBig ? error.message : "The upload didn't go through. Check your connection and try again." });
      }
    });
  const r = state?.result;
  const set = (tag: string, change: Partial<Received>, expected: string) =>
    setCounts((c) => ({ ...c, [tag]: { ...c[tag], quantity: c[tag]?.quantity ?? expected, ...change } }));
  // Changing a count or a reason means the shipment must be checked again before it can be received.
  const ready = r && !r.received && r.problems.length === 0 && r.accepted > 0;

  if (r?.received)
    return (
      <div className="space-y-3 text-sm" data-testid="shipment-received">
        <p className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 font-medium text-brand-900">
          Received manifest {r.manifestNumber}: {r.accepted} package{r.accepted === 1 ? "" : "s"}
          {r.short ? `, ${r.short} short` : ""}
          {r.rejected ? `, ${r.rejected} didn't arrive` : ""}.
        </p>
        <p className="text-slate-700">
          One record was added to State reporting: accept manifest {r.manifestNumber} in {r.stateSystem}, with what was short or didn&apos;t arrive.{" "}
          <Link href="/compliance" className="font-semibold text-brand-700 underline">
            See State reporting
          </Link>
        </p>
      </div>
    );

  return (
    <form ref={form} className="space-y-4" onSubmit={(e) => e.preventDefault()} data-testid="shipment-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-800">Manifest number</span>
          <input name="manifestNumber" required className={inputClass} onChange={() => setState(null)} />
        </label>
        <CreatableSelect
          name="locationId"
          label="Put away to"
          required
          placeholder="Choose a location"
          options={locations.map((l) => ({ id: l.id, label: l.name }))}
          onChange={() => setState(null)}
          create={addLocation}
          deniedHint="Location missing? Someone who manages the catalog can add it on the Locations page."
        />
        <CreatableSelect
          name="vendorId" searchable
          label="Vendor (optional)"
          placeholder="Not listed"
          options={vendors.map((v) => ({ id: v.id, label: v.name }))}
          onChange={() => setState(null)}
          create={addVendor}
        />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-800">Manifest file (CSV or Excel)</span>
          <input
            name="file"
            type="file"
            required
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm"
            onChange={() => {
              setState(null);
              setCounts({});
            }}
          />
        </label>
      </div>

      {r?.lines.length ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm" data-testid="shipment-lines">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">On manifest</th>
                <th className="px-3 py-2">Arrived</th>
                <th className="px-3 py-2">Why the difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.lines.map((l) => (
                <tr key={l.tag}>
                  <td className="px-3 py-2 font-mono text-xs">{l.tag}</td>
                  <td className="px-3 py-2">
                    {l.itemName ?? l.product}
                    {!l.itemName && l.status !== "MISSING" ? <span className="block text-xs font-semibold text-red-700">Not in Leaf2Sale</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">{l.quantity}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <input
                        aria-label={`Arrived for ${l.tag}`}
                        inputMode="decimal"
                        className={`${inputClass} w-24`}
                        value={counts[l.tag]?.quantity ?? l.received}
                        onChange={(e) => set(l.tag, { quantity: e.target.value }, l.quantity)}
                        onBlur={() => go(check)}
                      />
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[l.status].tone}`}>{STATUS[l.status].text}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {l.status !== "MATCH" ? (
                      <input
                        aria-label={`Why ${l.tag} is different`}
                        placeholder="Damaged, short-shipped, refused…"
                        className={inputClass}
                        value={counts[l.tag]?.reason ?? l.reason ?? ""}
                        onChange={(e) => set(l.tag, { reason: e.target.value }, l.quantity)}
                        onBlur={() => go(check)}
                      />
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => go(check)}
          className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand-200 bg-white px-5 text-sm font-bold text-brand-800 hover:border-brand-500 disabled:opacity-60"
        >
          {pending && !ready ? "Checking…" : r ? "Check again" : "Check the manifest"}
        </button>
        {ready ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => go(receive)}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? "Receiving…" : `Receive ${r.accepted} package${r.accepted === 1 ? "" : "s"}`}
          </button>
        ) : null}
      </div>

      {state?.error ? (
        <p role="alert" className="whitespace-pre-line rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          {state.error}
        </p>
      ) : null}
      {r?.problems.length ? (
        <ul role="alert" className="list-disc space-y-1 rounded-lg border-l-4 border-red-600 bg-red-50 py-2 pl-8 pr-3 text-sm text-red-900" data-testid="shipment-problems">
          {r.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {ready ? (
        <p className="text-sm text-slate-600">
          {r.short || r.rejected
            ? `${r.short ? `${r.short} short` : ""}${r.short && r.rejected ? " and " : ""}${r.rejected ? `${r.rejected} that didn't arrive` : ""} will be recorded with your reasons. `
            : "Everything arrived as listed. "}
          State reporting gets one record: accept manifest {r.manifestNumber} in {r.stateSystem}.
        </p>
      ) : null}
    </form>
  );
}
