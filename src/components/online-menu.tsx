"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { reserveAction } from "@/app/menu/[slug]/actions";
import type { PublicMenu, PublicMenuItem } from "@/lib/online-menu";

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
const anchor = (name: string) => `cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** A soft color per category so the cards read like a real shop's shelves. Picked by name, so it never changes. */
const SWATCHES = [
  "from-emerald-600 to-teal-700",
  "from-lime-600 to-emerald-700",
  "from-amber-500 to-orange-600",
  "from-violet-600 to-fuchsia-700",
  "from-sky-600 to-indigo-700",
  "from-rose-500 to-pink-700",
];
const swatch = (name: string) => SWATCHES[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % SWATCHES.length];

function Leaf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 21v-6" />
      <path d="M12 15c0-6 0-9 0-12 1.5 3 2.5 6.5 0 12Z" />
      <path d="M12 15c-3-2-6-2.5-9-2 2 2 5 3.5 9 2Z" />
      <path d="M12 15c3-2 6-2.5 9-2-2 2-5 3.5-9 2Z" />
      <path d="M12 15c-2-3-3.5-6-4-9 2.5 1.5 4.5 4.5 4 9Z" />
      <path d="M12 15c2-3 3.5-6 4-9-2.5 1.5-4.5 4.5-4 9Z" />
    </svg>
  );
}

/** The public menu: age confirmation, what's in stock, and (when the store allows it) a pickup reservation. */
export function OnlineMenu({ menu }: { menu: PublicMenu }) {
  const router = useRouter();
  // null while the server renders, so the page never flashes the menu to someone who has not confirmed.
  const stored = useSyncExternalStore(noSubscribe, readAge, () => null);
  const [confirmedHere, setConfirmedHere] = useState(false);
  const ofAge = stored === null ? null : stored || confirmedHere;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const all = useMemo(() => menu.categories.flatMap((c) => c.items), [menu]);
  const chosen = all.filter((i) => (qty[i.id] ?? 0) > 0);
  const count = chosen.reduce((n, i) => n + (i.whole ? (qty[i.id] ?? 0) : 1), 0);
  const total = chosen.reduce((sum, i) => sum + Number(i.price) * (qty[i.id] ?? 0), 0);
  const change = (id: string, delta: number, whole: boolean) =>
    setQty((q) => {
      const step = whole ? 1 : 0.5;
      const next = Math.max(0, Math.min(100, (q[id] ?? 0) + delta * step));
      return { ...q, [id]: next };
    });

  const term = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      menu.categories
        .map((c) => ({ ...c, items: term ? c.items.filter((i) => `${i.name} ${i.strain ?? ""} ${c.name}`.toLowerCase().includes(term)) : c.items }))
        .filter((c) => c.items.length > 0),
    [menu, term],
  );
  const reserving = menu.takeReservations && menu.categories.length > 0;

  if (ofAge === null) return <div className="min-h-[60vh]" aria-hidden="true" />;
  if (!ofAge) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-950/95 p-5 backdrop-blur">
        <div role="dialog" aria-labelledby="age-title" className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl" data-testid="age-gate">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-800">
            <Leaf className="h-8 w-8" />
          </div>
          <p className="mt-4 text-sm font-semibold uppercase tracking-widest text-brand-700">{menu.storeName}</p>
          <h2 id="age-title" className="mt-1 text-3xl font-extrabold text-slate-900">Are you 21 or older?</h2>
          <p className="mt-3 text-slate-600">You must be 21 or older to view this menu. Bring a valid ID to the store.</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
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
              className="min-h-12 rounded-xl bg-brand-700 px-5 font-bold text-white shadow-sm hover:bg-brand-800"
            >
              Yes, I&apos;m 21 or older
            </button>
            <a href="https://www.google.com" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-5 font-bold text-slate-700 hover:bg-slate-50">
              No
            </a>
          </div>
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
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-brand-950/95 text-white backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3">
          <a href="#top" className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/30 text-brand-100">
              <Leaf className="h-5 w-5" />
            </span>
            <span className="truncate text-lg font-extrabold tracking-tight">{menu.storeName}</span>
          </a>
          {reserving ? (
            <a href="#reserve" className="ml-auto inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-brand-900 hover:bg-brand-50">
              Pickup order
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-700 px-1.5 text-xs text-white tabular-nums">{count}</span>
            </a>
          ) : null}
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 text-white">
        <Leaf className="pointer-events-none absolute -right-10 -top-6 h-72 w-72 text-white/5 sm:h-96 sm:w-96" />
        <div className="relative mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-200">{menu.businessName}</p>
          <h1 className="mt-2 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">{menu.storeName}</h1>
          <p className="mt-4 max-w-2xl whitespace-pre-line text-lg text-brand-100">{menu.welcome || "Browse what's on our shelves today."}</p>
          <div className="mt-6 flex flex-wrap gap-2 text-sm font-semibold">
            {menu.takeReservations ? <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/20">Order ahead for pickup</span> : null}
            <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/20">Pay in store</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/20">21+ with valid ID</span>
          </div>
          {all.length ? (
            <a href="#menu" className="mt-8 inline-flex min-h-12 items-center rounded-xl bg-white px-6 font-bold text-brand-900 shadow-lg hover:bg-brand-50">
              Shop the menu ({all.length} item{all.length === 1 ? "" : "s"})
            </a>
          ) : null}
        </div>
      </section>

      {/* Category tabs and search */}
      {menu.categories.length ? (
        <div className="sticky top-[61px] z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
            <nav aria-label="Categories" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:pb-0">
              {menu.categories.map((c) => (
                <a key={c.name} href={`#${anchor(c.name)}`} className="shrink-0 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-brand-500 hover:text-brand-800">
                  {c.name}
                </a>
              ))}
            </nav>
            <label className="relative sm:ml-auto sm:w-64">
              <span className="sr-only">Search the menu</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search strains and products"
                className="block min-h-11 w-full rounded-full border border-slate-300 bg-slate-50 px-4 text-sm focus:border-brand-600 focus:bg-white focus:outline-none"
              />
            </label>
          </div>
        </div>
      ) : null}

      <main id="menu" className="mx-auto max-w-6xl scroll-mt-32 px-5 py-10">
        <div className={reserving ? "grid gap-10 lg:grid-cols-[1fr_22rem]" : ""}>
          <div className="space-y-12">
            {menu.categories.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-700">Nothing is on the menu right now. Please check back soon.</p>
            ) : null}
            {menu.categories.length && shown.length === 0 ? (
              <p className="rounded-2xl bg-white p-8 text-center text-slate-600">
                Nothing matches &ldquo;{search}&rdquo;.{" "}
                <button type="button" onClick={() => setSearch("")} className="font-semibold text-brand-700 underline">
                  Show everything
                </button>
              </p>
            ) : null}
            {shown.map((c) => (
              <section key={c.name} id={anchor(c.name)} aria-labelledby={`${anchor(c.name)}-h`} className="scroll-mt-40">
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 id={`${anchor(c.name)}-h`} className="text-2xl font-extrabold tracking-tight text-slate-900">{c.name}</h2>
                  <span className="text-sm text-slate-500">
                    {c.items.length} item{c.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {c.items.map((i) => (
                    <ProductCard key={i.id} item={i} category={c.name} reserving={menu.takeReservations} quantity={qty[i.id] ?? 0} onChange={(d) => change(i.id, d, i.whole)} />
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-xs text-slate-500">Prices before tax. Availability can change; the store confirms everything when you arrive. Purchase limits apply. Valid ID required.</p>
          </div>

          {reserving ? (
            <aside id="reserve" className="h-fit scroll-mt-36 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-36" aria-labelledby="res-title">
              <h2 id="res-title" className="text-xl font-extrabold text-slate-900">Reserve for pickup</h2>
              {chosen.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">Tap + on items you want and we&apos;ll set them aside. You pay in the store.</p>
              ) : (
                <>
                  <ul className="mt-4 space-y-2 text-sm">
                    {chosen.map((i) => (
                      <li key={i.id} className="flex justify-between gap-2">
                        <span>
                          {qty[i.id]} × {i.name}
                        </span>
                        <span className="tabular-nums">{usd(Number(i.price) * (qty[i.id] ?? 0))}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 flex justify-between border-t border-slate-100 pt-3 font-bold">
                    <span>Estimate (before tax)</span>
                    <span className="tabular-nums">{usd(total)}</span>
                  </p>
                  <div className="mt-5 space-y-3">
                    <label className="block text-sm font-semibold">
                      Your name
                      <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" />
                    </label>
                    <label className="block text-sm font-semibold">
                      Phone
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" inputMode="tel" className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" />
                    </label>
                    <label className="block text-sm font-semibold">
                      Note for the store (optional)
                      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" />
                    </label>
                    <div className="absolute -left-[9999px]" aria-hidden="true">
                      <label>
                        Website
                        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                      </label>
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1 h-5 w-5 accent-brand-700" />
                      <span>I am 21 or older and will bring a valid ID.</span>
                    </label>
                    {error ? (
                      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">
                        {error}
                      </p>
                    ) : null}
                    <button type="button" onClick={submit} disabled={pending} className="min-h-12 w-full rounded-xl bg-brand-700 px-5 font-bold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60">
                      {pending ? "Reserving…" : "Reserve for pickup"}
                    </button>
                  </div>
                </>
              )}
            </aside>
          ) : null}
        </div>
      </main>

      {/* Phone: a checkout bar that follows the shopper once something is picked */}
      {reserving && chosen.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:hidden">
          <a href="#reserve" className="mx-auto flex min-h-12 max-w-lg items-center justify-between rounded-xl bg-brand-700 px-5 font-bold text-white shadow-lg">
            <span>
              View pickup order · {count} item{count === 1 ? "" : "s"}
            </span>
            <span className="tabular-nums">{usd(total)}</span>
          </a>
        </div>
      ) : null}
    </>
  );
}

function ProductCard({ item, category, reserving, quantity, onChange }: { item: PublicMenuItem; category: string; reserving: boolean; quantity: number; onChange: (delta: number) => void }) {
  return (
    <li className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" data-testid="menu-item">
      <div className={`relative flex h-28 items-center justify-center bg-gradient-to-br ${swatch(category)}`}>
        <Leaf className="h-14 w-14 text-white/80 transition group-hover:scale-110" />
        <span className="absolute left-3 top-3 rounded-full bg-black/25 px-2.5 py-1 text-xs font-semibold text-white">{category}</span>
        {quantity > 0 ? <span className="absolute right-3 top-3 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-brand-900">{quantity} in order</span> : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-base font-bold leading-snug text-slate-900">{item.name}</h3>
        {item.strain ? <p className="mt-0.5 text-sm text-slate-600">{item.strain}</p> : null}
        {item.thc || item.cbd ? (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-bold">
            {item.thc ? <span className="rounded-md bg-brand-50 px-2 py-1 text-brand-800 ring-1 ring-brand-200">THC {item.thc}%</span> : null}
            {item.cbd ? <span className="rounded-md bg-sky-50 px-2 py-1 text-sky-800 ring-1 ring-sky-200">CBD {item.cbd}%</span> : null}
          </div>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <p>
            <span className="text-xl font-extrabold text-slate-900 tabular-nums">{usd(Number(item.price))}</span>
            <span className="ml-1 text-sm text-slate-500">{item.whole ? "each" : `/ ${item.unitLabel}`}</span>
          </p>
          {reserving ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                aria-label={`Fewer ${item.name}`}
                onClick={() => onChange(-1)}
                className="h-10 w-10 rounded-full border border-slate-300 text-lg font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-30"
                disabled={quantity <= 0}
              >
                −
              </button>
              <span className="w-7 text-center font-bold tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button type="button" aria-label={`More ${item.name}`} onClick={() => onChange(1)} className="h-10 w-10 rounded-full bg-brand-700 text-lg font-bold text-white shadow-sm hover:bg-brand-800">
                +
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
