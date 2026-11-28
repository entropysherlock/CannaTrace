"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
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

/** A soft color per category so the cards without a photo still read like a shop's shelves. Picked by name. */
const SWATCHES = [
  "from-emerald-600 to-teal-700",
  "from-lime-600 to-emerald-700",
  "from-amber-500 to-orange-600",
  "from-violet-600 to-fuchsia-700",
  "from-sky-600 to-indigo-700",
  "from-rose-500 to-pink-700",
];
const swatch = (name: string) => SWATCHES[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % SWATCHES.length];

type IconProps = { className?: string };
const Svg = ({ className, children }: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

function Leaf({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 21v-6" />
      <path d="M12 15c0-6 0-9 0-12 1.5 3 2.5 6.5 0 12Z" />
      <path d="M12 15c-3-2-6-2.5-9-2 2 2 5 3.5 9 2Z" />
      <path d="M12 15c3-2 6-2.5 9-2-2 2-5 3.5-9 2Z" />
      <path d="M12 15c-2-3-3.5-6-4-9 2.5 1.5 4.5 4.5 4 9Z" />
      <path d="M12 15c2-3 3.5-6 4-9-2.5 1.5-4.5 4.5-4 9Z" />
    </Svg>
  );
}
const PreRollIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M4 17 15 6M7 20 18 9M15 6l3 3M4 17l3 3" />
    <path d="M17.5 3.5c1.2-1 2.4 0 1.4 1.4s0 2.2 1.6 1.6" />
  </Svg>
);
const VapeIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="8" y="9" width="6" height="12" rx="1.5" />
    <rect x="10" y="5" width="2" height="4" />
    <circle cx="17.5" cy="5" r="1.4" />
  </Svg>
);
const GummyIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="12" cy="9" r="4" />
    <circle cx="8" cy="5.2" r="1.8" />
    <circle cx="16" cy="5.2" r="1.8" />
    <path d="M7.5 21c0-4 1-6 4.5-6s4.5 2 4.5 6z" />
    <path d="M10.6 9h.01M13.4 9h.01" />
  </Svg>
);
const hex = (cx: number, cy: number, r = 3.2) => {
  const w = r * 0.866;
  return `M${cx} ${cy - r}l${w} ${r / 2}v${r}l${-w} ${r / 2}l${-w} ${-r / 2}v${-r}z`;
};
const ConcentrateIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d={hex(8.2, 8)} />
    <path d={hex(15.8, 8)} />
    <path d={hex(12, 14.6)} />
  </Svg>
);
const TopicalIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M5 11h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
    <path d="M6 11V9a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" />
    <path d="M9 6.5c0-2 6-2 6 0M10.2 4.6c0-1.2 3.6-1.2 3.6 0" />
  </Svg>
);
const DrinkIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M9 3h6v3l1.5 2v11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V8L9 6z" />
    <path d="M8 13h8" />
  </Svg>
);
const TinctureIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M10 2h4v4h-4zM11 6h2v2h-2z" />
    <path d="M8 8h8v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z" />
    <path d="M12 12c1.5 2 2 3 0 4.5-2-1.5-1.5-2.5 0-4.5z" />
  </Svg>
);
const GridIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
);
const BagIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M6 8h12l1 12H5z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </Svg>
);
const CashIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);
const ShieldIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
const SearchIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
const ArrowIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

/** The line icon for a category tile, picked from its name. Anything unrecognized gets a neutral grid. */
function iconFor(category: string): (p: IconProps) => ReactNode {
  const n = category.toLowerCase();
  if (/flower|bud/.test(n)) return Leaf;
  if (/pre-?roll|joint/.test(n)) return PreRollIcon;
  if (/vape|cart|disposable/.test(n)) return VapeIcon;
  if (/edible|gummy|gummies|chocolate|candy/.test(n)) return GummyIcon;
  if (/concentrate|wax|resin|rosin|shatter|dab/.test(n)) return ConcentrateIcon;
  if (/topical|balm|lotion|salve|cream/.test(n)) return TopicalIcon;
  if (/drink|beverage|soda|tea|coffee/.test(n)) return DrinkIcon;
  if (/tincture|oil|dropper/.test(n)) return TinctureIcon;
  return GridIcon;
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
  const [category, setCategory] = useState<string | null>(null);
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
        .filter((c) => !category || c.name === category)
        .map((c) => ({ ...c, items: term ? c.items.filter((i) => `${i.name} ${i.strain ?? ""} ${c.name}`.toLowerCase().includes(term)) : c.items }))
        .filter((c) => c.items.length > 0),
    [menu, term, category],
  );
  const reserving = menu.takeReservations && menu.categories.length > 0;
  const pick = (name: string) => {
    setCategory((current) => (current === name ? null : name));
    window.requestAnimationFrame(() => document.getElementById("menu")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

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

  const perks = [
    ...(menu.takeReservations ? [{ icon: BagIcon, title: "Store Pickup", text: "Order online, pick up in store" }] : []),
    { icon: CashIcon, title: "Pay in Store", text: "Nothing is charged online" },
    { icon: Leaf, title: "Fresh Menu", text: "Only what's on our shelves now" },
    { icon: ShieldIcon, title: "21+ with ID", text: "Bring a valid ID to the store" },
  ];

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-brand-950/95 text-white backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <a href="#top" className="flex min-w-0 items-center gap-2">
            <Leaf className="h-8 w-8 shrink-0 text-lime-300" />
            <span className="truncate text-xl font-extrabold tracking-tight">{menu.storeName}</span>
          </a>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-7 text-sm font-semibold sm:flex">
            <a href="#menu" className="border-b-2 border-lime-300 pb-1">Menu</a>
            {reserving ? (
              <a href="#reserve" className="pb-1 text-white/80 hover:text-white">Pickup order</a>
            ) : null}
          </nav>
          {reserving ? (
            <a href="#reserve" aria-label={`Pickup order, ${count} item${count === 1 ? "" : "s"}`} className="relative ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10 sm:ml-0">
              <BagIcon className="h-6 w-6" />
              <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-lime-300 px-1 text-[11px] font-extrabold text-brand-950 tabular-nums">{count}</span>
            </a>
          ) : null}
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_88%_25%,rgba(190,242,100,0.20),transparent)]" aria-hidden="true" />
        <Leaf className="pointer-events-none absolute -left-16 top-4 h-72 w-72 -rotate-12 text-lime-200/10 sm:h-96 sm:w-96" />
        <Leaf className="pointer-events-none absolute -right-10 -top-10 hidden h-[26rem] w-[26rem] rotate-12 text-lime-200/10 sm:block" />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-12 sm:pb-24 sm:pt-16">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-lime-300 sm:text-sm">{menu.businessName}</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{menu.storeName}</h1>
          <p className="mt-4 max-w-xl whitespace-pre-line text-base text-brand-100 sm:text-lg">
            {menu.welcome || (menu.takeReservations ? "Shop by category, reserve online, and pick up in store." : "Shop by category and see what's on our shelves today.")}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            {all.length ? (
              <a href="#menu" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-lime-300 px-6 font-bold text-brand-950 shadow-lg hover:bg-lime-200">
                <BagIcon className="h-5 w-5" />
                Browse Menu
                <ArrowIcon className="h-5 w-5" />
              </a>
            ) : null}
            {reserving ? (
              <a href="#reserve" className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-lime-300/70 px-6 font-bold text-white hover:bg-white/10">
                Order for pickup
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* Search, overlapping the hero's bottom edge */}
      {menu.categories.length ? (
        <div className="relative z-10 -mt-7 px-5">
          <label className="mx-auto flex min-h-14 max-w-4xl items-center gap-3 rounded-full border border-slate-200 bg-white px-5 shadow-xl focus-within:border-brand-600">
            <SearchIcon className="h-5 w-5 shrink-0 text-slate-500" />
            <span className="sr-only">Search the menu</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search strains and products"
              className="min-w-0 flex-1 bg-transparent py-3 text-base text-slate-900 placeholder:text-slate-500 focus:outline-none"
            />
          </label>
        </div>
      ) : null}

      {/* Category tiles */}
      {menu.categories.length ? (
        <nav aria-label="Categories" className="mx-auto max-w-6xl px-5 pt-8">
          <ul className="-mx-1 grid auto-cols-[6.5rem] grid-flow-col gap-3 overflow-x-auto px-1 pb-3 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] sm:overflow-visible">
            {menu.categories.map((c) => {
              const Icon = iconFor(c.name);
              const active = category === c.name;
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => pick(c.name)}
                    aria-pressed={active}
                    className={`flex h-full w-full flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                      active ? "border-brand-600 bg-brand-50 ring-2 ring-brand-600" : "border-slate-200 bg-white"
                    }`}
                  >
                    <Icon className="h-9 w-9 text-brand-800" />
                    <span className="text-sm font-bold text-slate-900">{c.name}</span>
                    <span className="-mt-1 text-xs text-slate-500">{c.items.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {/* What to expect */}
      {all.length ? (
        <section aria-label="How it works" className="mx-auto max-w-6xl px-5 pt-4">
          <ul className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
            {perks.map((p) => (
              <li key={p.title} className="flex items-center gap-3 bg-white px-5 py-4">
                <p.icon className="h-8 w-8 shrink-0 text-brand-700" />
                <div>
                  <p className="text-sm font-bold text-slate-900">{p.title}</p>
                  <p className="text-xs text-slate-600">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <main id="menu" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-10">
        {category || term ? (
          <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            Showing {category ?? "everything"}
            {term ? ` matching “${search.trim()}”` : ""}.
            <button
              type="button"
              onClick={() => {
                setCategory(null);
                setSearch("");
              }}
              className="font-semibold text-brand-700 underline"
            >
              Show everything
            </button>
          </p>
        ) : null}
        <div className={reserving ? "grid gap-10 lg:grid-cols-[1fr_22rem]" : ""}>
          <div className="min-w-0 space-y-12">
            {menu.categories.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-700">Nothing is on the menu right now. Please check back soon.</p>
            ) : null}
            {menu.categories.length && shown.length === 0 ? (
              <p className="rounded-2xl bg-white p-8 text-center text-slate-600">
                Nothing matches &ldquo;{search}&rdquo;.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategory(null);
                  }}
                  className="font-semibold text-brand-700 underline"
                >
                  Show everything
                </button>
              </p>
            ) : null}
            {shown.map((c) => (
              <section key={c.name} id={anchor(c.name)} aria-labelledby={`${anchor(c.name)}-h`} className="scroll-mt-24">
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
            <aside id="reserve" className="h-fit scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-24" aria-labelledby="res-title">
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
    <li className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" data-testid="menu-item">
      <div className={item.image ? "relative flex h-48 items-center justify-center bg-white" : `relative flex h-28 items-center justify-center bg-gradient-to-br ${swatch(category)}`}>
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt={item.name} width={600} height={600} loading="lazy" className="h-full w-full object-contain p-2 transition group-hover:scale-105" />
        ) : (
          <Leaf className="h-14 w-14 text-white/80 transition group-hover:scale-110" />
        )}
        <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold ${item.image ? "bg-slate-900/70 text-white" : "bg-black/25 text-white"}`}>{category}</span>
        {quantity > 0 ? <span className="absolute right-3 top-3 rounded-full bg-brand-900 px-2.5 py-1 text-xs font-bold text-white">{quantity} in order</span> : null}
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
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-3 pt-4">
          <p className="min-w-0">
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
