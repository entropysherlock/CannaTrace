"use client";

import { Minus, PauseCircle, Plus, ScanLine, Search, Trash2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { terminalAdd, terminalCancel, terminalDiscount, terminalScan, terminalSetQuantity, type TerminalResult } from "@/app/(app)/pos/terminal-actions";
import { beep } from "./feedback";
import { PayPanel, money } from "./pay-panel";
import { RewardsPanel, type RewardsView } from "./rewards-panel";
import { Toasts, useToasts } from "./shell";
import { useScanner } from "./use-scanner";

export type MenuTile = {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: string;
  unitLabel: string;
  stock: string;
  outOfStock: boolean;
  limitNote: string | null;
};

export type CartLineView = { id: string; itemId: string; name: string; quantity: string; unitPrice: string; lineTotal: string; unitLabel: string };

export type CartView = {
  saleId: string;
  number: string;
  customerLabel: string;
  checkedBy: string;
  lines: CartLineView[];
  menu: MenuTile[];
  categories: string[];
  discounts: { id: string; name: string; label: string }[];
  discountName: string | null;
  totals: { subtotal: string; discount: string; reward: string; exciseTax: string; salesTax: string; total: string };
  /** The rewards box, when the business's rewards program is on. */
  rewards: RewardsView | null;
  taxLabels: { excise: string; sales: string };
  limits: { label: string; used: string; limit: string; unit: string; share: number }[];
  quickCash: string[];
  /** Items from a pickup reservation that could not be added (sold out, or over a purchase limit). */
  notAdded?: string[];
};

/** Category stripe colors: common product types get a fixed color; others take the next free one in order. */
const KNOWN_COLORS: [RegExp, string][] = [
  [/flower|bud/i, "#2f8a4c"],
  [/pre-?roll|joint/i, "#c27c0e"],
  [/concentrate|extract|wax|resin|rosin/i, "#7c3aed"],
  [/vape|cart/i, "#2563eb"],
  [/edible|gumm|chocolate|beverage|drink/i, "#d1366f"],
  [/topical|tincture|capsule/i, "#0e7490"],
];
const SPARE_COLORS = ["#9a6b3a", "#4d7c0f", "#be123c", "#0369a1"];
const OTHER_COLOR = "#64748b";

const dollars = (value: string) => money(Math.round(Number(value) * 100));

export function CartScreen({ view }: { view: CartView }) {
  const router = useRouter();
  const { toasts, push } = useToasts();
  const [pending, start] = useTransition();
  const [busyTile, setBusyTile] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [paying, setPaying] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [noticeOpen, setNoticeOpen] = useState(true);

  const colorOf = useMemo(() => {
    let spare = 0;
    const map = new Map(
      view.categories.map((c) => [c, KNOWN_COLORS.find(([re]) => re.test(c))?.[1] ?? SPARE_COLORS[spare++] ?? OTHER_COLOR]),
    );
    return (c: string) => map.get(c) ?? OTHER_COLOR;
  }, [view.categories]);

  const report = useCallback(
    (result: TerminalResult, okText?: string) => {
      if (result.error) {
        beep("error");
        push("error", result.error);
        return false;
      }
      beep("ok");
      const text = result.ok ?? okText;
      if (text) push("ok", text);
      return true;
    },
    [push],
  );

  const act = (work: () => Promise<TerminalResult>, okText?: string, tile?: string) => {
    if (tile) setBusyTile(tile);
    start(async () => {
      report(await work(), okText);
      setBusyTile(null);
    });
  };

  const scan = useCallback(
    (code: string) => {
      start(async () => {
        report(await terminalScan(view.saleId, code.trim()));
      });
    },
    [report, view.saleId],
  );
  useScanner(scan, { enabled: !paying });

  const shown = view.menu.filter((m) => {
    if (category !== "All" && m.category !== category) return false;
    const q = query.trim().toLowerCase();
    return !q || m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q);
  });

  const submitSearch = () => {
    const q = query.trim();
    if (!q) return;
    const exact = view.menu.filter((m) => !m.outOfStock && (m.name.toLowerCase() === q.toLowerCase() || m.sku.toLowerCase() === q.toLowerCase()));
    const only = shown.filter((m) => !m.outOfStock);
    const pick = exact.length === 1 ? exact[0] : only.length === 1 ? only[0] : null;
    setQuery("");
    if (pick) act(() => terminalAdd(view.saleId, pick.id), `Added ${pick.name}`, pick.id);
    else scan(q); // a package tag or SKU typed by hand
  };

  // A visited page can come back from Next.js's hidden cache: start it fresh each time.
  useEffect(
    () => () => {
      setPaying(false);
      setQuery("");
      setConfirmCancel(false);
    },
    [],
  );

  const canPay = view.lines.length > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paying) return;
      const typing = document.activeElement instanceof HTMLInputElement && document.activeElement !== search.current;
      if (e.key === "F2" && canPay) {
        e.preventDefault();
        setPaying(true);
      } else if (e.key === "F4") {
        e.preventDefault();
        router.push("/pos");
      } else if (e.key === "/" && !typing && document.activeElement !== search.current) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paying, canPay, router]);

  const itemCount = view.lines.length;

  return (
    <div className="grid h-full grid-cols-1 overflow-y-auto lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:overflow-hidden">
      {view.notAdded && view.notAdded.length > 0 && noticeOpen ? (
        <div role="alert" data-testid="not-added" className="fixed inset-x-4 top-20 z-40 mx-auto max-w-xl rounded-2xl bg-amber-50 p-4 shadow-lg ring-1 ring-amber-300">
          <p className="font-bold text-amber-950">Some reserved items could not be added:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-950">
            {view.notAdded.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setNoticeOpen(false)} className="mt-3 min-h-10 rounded-lg bg-amber-200 px-4 font-bold text-amber-950">
            Got it
          </button>
        </div>
      ) : null}
      {/* Products */}
      <section aria-label="Products" className="flex flex-col lg:min-h-0">
        <div className="space-y-3 border-b border-slate-200 bg-white px-4 py-3">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
            className="flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 focus-within:border-brand-600"
          >
            <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, or scan a tag or SKU"
              aria-label="Search products, or scan a tag or SKU"
              autoComplete="off"
              className="h-12 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-slate-400"
            />
            <span className="hidden items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 sm:inline-flex">
              <ScanLine className="h-4 w-4" aria-hidden="true" /> Scanner ready
            </span>
          </form>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist" aria-label="Categories">
            {["All", ...view.categories].map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={`flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-base font-semibold transition-colors ${
                  category === c ? "bg-brand-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {c !== "All" ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(c) }} aria-hidden="true" /> : null}
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {view.menu.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-lg text-slate-600">Nothing is on this store&apos;s menu yet. A manager can add items under Menu.</p>
          ) : shown.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-lg text-slate-600">No products match. Press Enter to look it up as a tag or SKU.</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3">
              {shown.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={m.outOfStock || pending}
                    onClick={() => act(() => terminalAdd(view.saleId, m.id), `Added ${m.name}`, m.id)}
                    aria-label={`Add ${m.name}, ${dollars(m.price)}`}
                    className="group relative flex h-36 w-full flex-col overflow-hidden rounded-2xl bg-white p-3 pl-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-2 hover:ring-brand-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:ring-slate-200"
                  >
                    <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: colorOf(m.category) }} aria-hidden="true" />
                    <span className="line-clamp-2 text-base font-bold leading-snug text-slate-950">{m.name}</span>
                    <span className="mt-0.5 text-xs font-medium text-slate-500">{m.category}</span>
                    <span className="mt-auto flex items-end justify-between gap-2">
                      <span className="font-display text-2xl font-bold tabular-nums text-slate-950">
                        {dollars(m.price)}
                        <span className="ml-1 font-sans text-xs font-medium text-slate-500">/{m.unitLabel}</span>
                      </span>
                      <span className={`text-xs font-semibold ${m.outOfStock ? "text-red-700" : "text-slate-500"}`}>{m.outOfStock ? "Sold out" : `${m.stock} left`}</span>
                    </span>
                    {m.limitNote ? <span className="mt-1 text-[11px] font-medium text-slate-500">{m.limitNote}</span> : null}
                    {busyTile === m.id ? <span className="absolute inset-0 animate-pulse bg-brand-100/60" aria-hidden="true" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Cart */}
      <aside aria-label="Cart" className="flex flex-col border-t border-slate-200 bg-white lg:min-h-0 lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight">Cart {view.number}</h1>
            <p className="truncate text-sm text-slate-600">
              {view.customerLabel} · ID checked by {view.checkedBy}
            </p>
          </div>
          <span className={`h-3 w-3 shrink-0 rounded-full ${pending ? "animate-pulse bg-amber-500" : "bg-brand-500"}`} title={pending ? "Saving" : "Saved"} aria-hidden="true" />
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {itemCount === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-slate-500">
              <ScanLine className="h-12 w-12 text-slate-300" aria-hidden="true" />
              <p className="text-lg font-semibold text-slate-700">Scan or tap a product to start</p>
              <p className="text-sm">Package tags and SKUs both work.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {view.lines.map((line) => (
                <li key={line.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold leading-snug text-slate-950">{line.name}</p>
                    <p className="font-semibold tabular-nums">{dollars(line.lineTotal)}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${line.name}`}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => act(() => terminalSetQuantity(line.id, String(Math.max(0, Number(line.quantity) - 1))))}
                        aria-label={`One less ${line.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:opacity-50"
                      >
                        <Minus className="h-5 w-5" aria-hidden="true" />
                      </button>
                      <span className="min-w-12 text-center text-lg font-bold tabular-nums" data-testid="line-qty">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => act(() => terminalSetQuantity(line.id, String(Number(line.quantity) + 1)))}
                        aria-label={`One more ${line.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:opacity-50"
                      >
                        <Plus className="h-5 w-5" aria-hidden="true" />
                      </button>
                      <span className="ml-2 text-sm text-slate-500">
                        × {dollars(line.unitPrice)}/{line.unitLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => terminalSetQuantity(line.id, "0"))}
                      aria-label={`Remove ${line.name}`}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {view.rewards ? (
            <div className="px-4 pb-3">
            <RewardsPanel
              saleId={view.saleId}
              view={view.rewards}
              pending={pending}
              act={(work, okText, after) =>
                start(async () => {
                  const result = await work();
                  if (!result.notFound) report(result, okText);
                  after?.(result);
                })
              }
            />
            </div>
          ) : null}
        </div>

        <div className="space-y-3 border-t border-slate-200 bg-[#f6f9f7] px-4 py-3 lg:max-h-[55%] lg:overflow-y-auto">
          <div className="grid grid-cols-3 gap-3" aria-label="Purchase limits">
            {view.limits.map((l) => (
              <div key={l.label}>
                <div className="flex justify-between text-[11px] font-semibold text-slate-600">
                  <span>{l.label}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className={`h-full rounded-full ${l.share >= 90 ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${l.share}%` }} />
                </div>
                <p className="mt-0.5 text-[11px] tabular-nums text-slate-600">
                  {l.used} of {l.limit} {l.unit}
                </p>
              </div>
            ))}
          </div>

          {view.discounts.length ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Discount">
              {[
                { id: "", name: "", label: "No discount" },
                ...view.discounts,
                // A discount a manager has since removed stays on carts already using it: show it, so it's visible.
                ...(view.discountName && !view.discounts.some((d) => d.name === view.discountName)
                  ? [{ id: "__applied", name: view.discountName, label: `${view.discountName} (no longer offered)` }]
                  : []),
              ].map((d) => {
                const on = d.id ? view.discountName === d.name : view.discountName === null;
                return (
                  <button
                    key={d.id || "none"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={pending}
                    onClick={() => (d.id === "__applied" ? undefined : act(() => terminalDiscount(view.saleId, d.id)))}
                    className={`h-9 rounded-full px-3 text-sm font-semibold ${on ? "bg-brand-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-brand-600"}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-sm text-slate-600">
            <dt>Subtotal</dt>
            <dd className="text-right tabular-nums">{dollars(view.totals.subtotal)}</dd>
            {Number(view.totals.discount) > 0 ? (
              <>
                <dt>Discount ({view.discountName})</dt>
                <dd className="text-right tabular-nums">-{dollars(view.totals.discount)}</dd>
              </>
            ) : null}
            {Number(view.totals.reward) > 0 ? (
              <>
                <dt>Rewards ({view.rewards ? view.rewards.applied * view.rewards.redeemPoints : 0} pts)</dt>
                <dd className="text-right tabular-nums">-{dollars(view.totals.reward)}</dd>
              </>
            ) : null}
            <dt>{view.taxLabels.excise}</dt>
            <dd className="text-right tabular-nums">{dollars(view.totals.exciseTax)}</dd>
            <dt>{view.taxLabels.sales}</dt>
            <dd className="text-right tabular-nums">{dollars(view.totals.salesTax)}</dd>
          </dl>

          <button
            type="button"
            disabled={!canPay || pending}
            onClick={() => setPaying(true)}
            className="flex h-16 w-full items-center justify-between rounded-2xl bg-brand-700 px-5 text-white shadow-sm hover:bg-brand-800 disabled:bg-slate-300 disabled:text-slate-500"
          >
            <span className="text-lg font-bold">
              Pay <span className="ml-1 rounded bg-white/15 px-1.5 py-0.5 text-xs font-semibold">F2</span>
            </span>
            <span className="font-display text-3xl font-bold tabular-nums">{dollars(view.totals.total)}</span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => router.push("/pos")}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white text-base font-semibold text-slate-800 ring-1 ring-slate-200 hover:ring-brand-600"
            >
              <PauseCircle className="h-5 w-5" aria-hidden="true" /> Hold cart <span className="text-xs text-slate-400">F4</span>
            </button>
            {confirmCancel ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    if (report(await terminalCancel(view.saleId))) router.push("/pos");
                  })
                }
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-red-700 text-base font-semibold text-white hover:bg-red-800"
              >
                Yes, cancel cart
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmCancel(true);
                  setTimeout(() => setConfirmCancel(false), 4000);
                }}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white text-base font-semibold text-slate-800 ring-1 ring-slate-200 hover:text-red-700 hover:ring-red-300"
              >
                <XCircle className="h-5 w-5" aria-hidden="true" /> Cancel cart
              </button>
            )}
          </div>
        </div>
      </aside>

      {paying ? (
        <PayPanel
          saleId={view.saleId}
          total={view.totals.total}
          quickCash={view.quickCash}
          onClose={() => setPaying(false)}
          onError={(message) => push("error", message)}
        />
      ) : null}
      <Toasts toasts={toasts} />
    </div>
  );
}
