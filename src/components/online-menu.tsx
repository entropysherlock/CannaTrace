"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { reserveAction } from "@/app/menu/[slug]/actions";
import type { PublicMenu } from "@/lib/online-menu";

const AGE_KEY = "ct-menu-21";
const noSubscribe = () => () => {};
const readAge = () => {
  try {
    return window.sessionStorage.getItem(AGE_KEY) === "1";
  } catch {
    return false; // private mode: ask each visit
  }
};
const usd = (n: number) => `$${n.toFixed(2)}`;

/** The public menu: age confirmation, what's in stock, and (when the store allows it) a pickup reservation. */
export function OnlineMenu({ menu }: { menu: PublicMenu }) {
  const router = useRouter();
  // null while the server renders, so the page never flashes the menu to someone who has not confirmed.
  const stored = useSyncExternalStore(noSubscribe, readAge, () => null);
  const [confirmedHere, setConfirmedHere] = useState(false);
  const ofAge = stored === null ? null : stored || confirmedHere;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const all = useMemo(() => menu.categories.flatMap((c) => c.items), [menu]);
  const chosen = all.filter((i) => (qty[i.id] ?? 0) > 0);
  const total = chosen.reduce((sum, i) => sum + Number(i.price) * (qty[i.id] ?? 0), 0);
  const change = (id: string, delta: number, whole: boolean) =>
    setQty((q) => {
      const step = whole ? 1 : 0.5;
      const next = Math.max(0, Math.min(100, (q[id] ?? 0) + delta * step));
      return { ...q, [id]: next };
    });

  if (ofAge === null) return <div className="min-h-[50vh]" aria-hidden="true" />;
  if (!ofAge) {
    return (
      <div role="dialog" aria-labelledby="age-title" className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg" data-testid="age-gate">
        <h2 id="age-title" className="text-2xl font-extrabold text-slate-900">Are you 21 or older?</h2>
        <p className="mt-2 text-slate-600">You must be 21 or older to view this menu. Bring a valid ID to the store.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              try {
                window.sessionStorage.setItem(AGE_KEY, "1");
              } catch {
                /* ignore */
              }
              setConfirmedHere(true);
            }}
            className="min-h-12 rounded-xl bg-brand-700 px-5 font-bold text-white hover:bg-brand-800"
          >
            Yes, I&apos;m 21 or older
          </button>
          <a href="https://www.google.com" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-5 font-bold text-slate-700 hover:bg-slate-50">
            No
          </a>
        </div>
      </div>
    );
  }

  const submit = () => {
    setError("");
    start(async () => {
      const r = await reserveAction(menu.slug, { name, phone, note, adult, website, lines: chosen.map((i) => ({ itemId: i.id, quantity: String(qty[i.id]) })) });
      if (r.error || !r.id) {
        setError(r.error ?? "Could not reserve. Please try again.");
        return;
      }
      router.push(`/menu/${menu.slug}/r/${r.id}`);
    });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        {menu.categories.length === 0 ? <p className="rounded-xl bg-slate-50 p-6 text-slate-700">Nothing is on the menu right now. Please check back soon.</p> : null}
        {menu.categories.map((c) => (
          <section key={c.name} aria-labelledby={`cat-${c.name}`}>
            <h2 id={`cat-${c.name}`} className="mb-3 text-lg font-extrabold text-brand-950">{c.name}</h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {c.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="menu-item">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{i.name}</p>
                    <p className="text-sm text-slate-600">
                      {i.strain ? `${i.strain} · ` : ""}
                      {usd(Number(i.price))} {i.whole ? "each" : `per ${i.unitLabel}`}
                    </p>
                  </div>
                  {menu.takeReservations ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" aria-label={`Fewer ${i.name}`} onClick={() => change(i.id, -1, i.whole)} className="h-10 w-10 rounded-lg border border-slate-300 text-lg font-bold hover:bg-slate-50 disabled:opacity-40" disabled={(qty[i.id] ?? 0) <= 0}>
                        −
                      </button>
                      <span className="w-8 text-center font-bold tabular-nums" aria-live="polite">{qty[i.id] ?? 0}</span>
                      <button type="button" aria-label={`More ${i.name}`} onClick={() => change(i.id, 1, i.whole)} className="h-10 w-10 rounded-lg bg-brand-700 text-lg font-bold text-white hover:bg-brand-800">
                        +
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-slate-500">Prices before tax. Availability can change; the store confirms everything when you arrive. Purchase limits apply. Valid ID required.</p>
      </div>

      {menu.takeReservations && menu.categories.length > 0 ? (
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-20" aria-labelledby="res-title">
          <h2 id="res-title" className="text-lg font-extrabold text-slate-900">Reserve for pickup</h2>
          {chosen.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Tap + on items you want. You pay in the store.</p>
          ) : (
            <>
              <ul className="mt-3 space-y-1 text-sm">
                {chosen.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span>{qty[i.id]} × {i.name}</span>
                    <span className="tabular-nums">{usd(Number(i.price) * (qty[i.id] ?? 0))}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 font-bold"><span>Estimate (before tax)</span><span className="tabular-nums">{usd(total)}</span></p>
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-semibold">Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
                <label className="block text-sm font-semibold">Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" inputMode="tel" className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
                <label className="block text-sm font-semibold">Note for the store (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label>
                <div className="absolute -left-[9999px]" aria-hidden="true">
                  <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
                </div>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1 h-5 w-5" /><span>I am 21 or older and will bring a valid ID.</span></label>
                {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p> : null}
                <button type="button" onClick={submit} disabled={pending} className="min-h-12 w-full rounded-xl bg-brand-700 px-5 font-bold text-white hover:bg-brand-800 disabled:opacity-60">
                  {pending ? "Reserving…" : "Reserve for pickup"}
                </button>
              </div>
            </>
          )}
        </aside>
      ) : null}
    </div>
  );
}
