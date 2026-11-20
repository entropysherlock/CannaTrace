"use client";

import { AlertTriangle, CheckCircle2, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { receiveManifestAction } from "@/app/(app)/inbox/actions";
import type { ManifestContext } from "@/lib/scan/manifest";
import type { DocProposal } from "@/lib/scan/types";
import { inputClass } from "./ui";

type Row = { include: boolean; tag: string; product: string; unit: string; itemId: string; quantity: string; lot: string; existing: boolean };

/** A delivery manifest beside its photo: every package is filled in, the person checks it, one tap receives them all. */
export function ManifestReview({ attachmentId, name, isPdf, proposal, ctx }: { attachmentId: string; name: string; isPdf: boolean; proposal: DocProposal; ctx: ManifestContext }) {
  const src = `/api/assistant/attachments/${attachmentId}`;
  const [rows, setRows] = useState<Row[]>(ctx.lines.map((l) => ({ include: !l.existing, tag: l.tag, product: l.product, unit: l.unit, itemId: l.itemId, quantity: l.quantity, lot: l.lot, existing: l.existing })));
  const [locationId, setLocationId] = useState(ctx.locations.length === 1 ? ctx.locations[0].id : "");
  const [vendorId, setVendorId] = useState(ctx.vendorId);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const field = (key: string) => proposal.fields.find((f) => f.key === key)?.value ?? "";
  const chosen = rows.filter((r) => r.include);
  const unmatched = chosen.filter((r) => !r.itemId).length;
  const ready = chosen.length > 0 && Boolean(locationId) && unmatched === 0;
  const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await receiveManifestAction({ attachmentId, locationId, vendorId, lines: chosen.map((x) => ({ tag: x.tag, itemId: x.itemId, quantity: x.quantity, lot: x.lot })) });
      if (r.ok) setDone(r.count);
      else setError(r.error);
    });

  if (done !== null)
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-brand-200 bg-white p-8 text-center shadow-sm" data-testid="scan-done">
        <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" aria-hidden="true" />
        <h2 className="mt-3 font-display text-2xl font-bold">Received {done} package{done === 1 ? "" : "s"}</h2>
        <p className="mt-1 text-slate-600">They are in your inventory now{field("manifestNumber") ? `, from manifest ${field("manifestNumber")}` : ""}.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {/* A full load, so the lists show what was just received. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/inventory" className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">See the packages</a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/inbox" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Back to the inbox</a>
        </div>
      </div>
    );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]" data-testid="manifest-review">
      <div className="xl:sticky xl:top-4 xl:self-start">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {isPdf ? (
            <object data={src} type="application/pdf" className="h-[70vh] w-full" aria-label={name}>
              <p className="p-6 text-sm text-slate-600">This browser can&apos;t show the PDF here. <a className="font-semibold underline" href={src}>Open it</a>.</p>
            </object>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={name} className="max-h-[75vh] w-full bg-slate-100 object-contain" />
          )}
        </div>
        <p className="mt-2 truncate text-xs text-slate-500">{name}</p>
      </div>

      <div className="space-y-5 pb-28">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Transport manifest</p>
          <h2 className="font-display text-xl font-bold">{field("sender") || "Sender not found"}{field("manifestNumber") ? ` · ${field("manifestNumber")}` : ""}</h2>
          <p className="mt-1 text-sm text-slate-600">{[field("shipDate") && `Shipped ${field("shipDate")}`, field("receiver") && `To ${field("receiver")}`, field("driver") && `Driver ${field("driver")}`].filter(Boolean).join(" · ")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Put away to
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass} data-testid="manifest-location">
                <option value="">Choose a location</option>
                {ctx.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Bought from {ctx.vendorId && vendorId === ctx.vendorId ? <span className="text-xs font-semibold text-brand-700">· matched from the manifest</span> : null}
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass} data-testid="manifest-vendor">
                <option value="">Not bought from a vendor</option>
                {ctx.vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {proposal.warnings.length ? (
          <ul className="space-y-2" data-testid="doc-warnings">
            {proposal.warnings.map((w) => (
              <li key={w} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold">Packages <span className="font-normal text-slate-500">({rows.length})</span></h3>
          <ul className="mt-3 space-y-3" data-testid="manifest-lines">
            {rows.map((r, i) => (
              <li key={i} className={`rounded-xl border p-3 ${r.existing ? "border-amber-300 bg-amber-50" : r.include ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-70"}`}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} className="mt-1 h-5 w-5 accent-brand-700" aria-label={`Receive line ${i + 1}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{r.product || "No product name"}</span>
                    <span className="block text-xs text-slate-500">The manifest says {r.quantity || "?"} {r.unit}</span>
                  </span>
                </label>
                {r.existing ? <p className="mt-2 text-sm font-semibold text-amber-900">A package with this tag is already in your inventory, so it is left out.</p> : null}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-slate-600">
                    Item {r.itemId ? <span className="text-brand-700">· matched</span> : <span className="text-amber-700">· pick one</span>}
                    <select value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value })} className={inputClass} aria-label={`Item for line ${i + 1}`}>
                      <option value="">Choose an item</option>
                      {ctx.items.map((it) => (
                        <option key={it.id} value={it.id}>{it.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">
                    Package tag
                    <input value={r.tag} onChange={(e) => set(i, { tag: e.target.value.toUpperCase() })} placeholder="Blank = new PKG- ID" className={inputClass} aria-label={`Tag for line ${i + 1}`} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">
                    Quantity
                    <input value={r.quantity} inputMode="decimal" onChange={(e) => set(i, { quantity: e.target.value })} className={inputClass} aria-label={`Quantity for line ${i + 1}`} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600">
                    Lot
                    <input value={r.lot} onChange={(e) => set(i, { lot: e.target.value })} className={inputClass} aria-label={`Lot for line ${i + 1}`} />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-slate-700" role="status">
            {error ? <span className="font-semibold text-red-700" role="alert">{error}</span> : !locationId ? "Choose where the packages go." : unmatched ? `${unmatched} line${unmatched === 1 ? " needs" : "s need"} an item.` : chosen.length ? `Ready to receive ${chosen.length} package${chosen.length === 1 ? "" : "s"}.` : "Check the packages to receive."}
          </p>
          <Link href="/inbox" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Not now</Link>
          <button type="button" disabled={!ready || pending} onClick={submit} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50" data-testid="manifest-receive">
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            {pending ? "Receiving…" : `Receive ${chosen.length} package${chosen.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
