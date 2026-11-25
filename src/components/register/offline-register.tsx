"use client";

import Decimal from "decimal.js";
import { WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  buildSale,
  checkIn,
  enqueue,
  loadQueue,
  loadSnapshot,
  nextLocalNumber,
  priceCart,
  saveSnapshot,
  stockLeft,
  startOutage,
  endOutage,
  sendOutages,
  openOutageStart,
  syncQueue,
  type CartItem,
  type QueuedSale,
  type SyncSummary,
} from "@/lib/offline-client";
import type { OfflineSale, OfflineSnapshot } from "@/lib/offline-types";

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};
const noSubscribe = () => () => {};
const money = (d: Decimal.Value) => `$${new Decimal(d).toFixed(2)}`;
const field = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base";

/** The register for when the internet is down. Cash only; everything is saved on this device and sent when the connection returns. */
export function OfflineRegister({ fresh }: { fresh: OfflineSnapshot | null }) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [cart, setCart] = useState<Record<string, string>>({});
  const [customerType, setCustomerType] = useState<"ADULT_USE" | "MEDICAL">("ADULT_USE");
  const [birthDate, setBirthDate] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [idExpires, setIdExpires] = useState("");
  const [discountId, setDiscountId] = useState("");
  const [cash, setCash] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OfflineSale | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(id);
  }, [tick]);

  // While online, keep the saved copy current (a copy served from the page cache with no internet must not replace a newer one).
  useEffect(() => {
    if (fresh && navigator.onLine) {
      saveSnapshot(fresh);
      const id = setTimeout(refresh, 0);
      return () => clearTimeout(id);
    }
  }, [fresh, refresh]);

  const send = useCallback(async () => {
    const result = await syncQueue();
    setSummary(result);
    refresh();
  }, [refresh]);

  // Keep an outage log: note when the connection drops, close it when it returns, and send it for the record.
  useEffect(() => {
    if (!mounted) return;
    if (!online) {
      startOutage();
      return;
    }
    endOutage(loadQueue().length);
    void sendOutages();
  }, [online, mounted]);

  // Send waiting sales on arrival and whenever the connection comes back.
  useEffect(() => {
    if (online && loadQueue().length > 0) {
      const id = setTimeout(() => void send(), 0);
      return () => clearTimeout(id);
    }
  }, [online, send]);

  const snap = useMemo(() => (mounted ? loadSnapshot() : null), [mounted, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const queue: QueuedSale[] = useMemo(() => (mounted ? loadQueue() : []), [mounted, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return <p className="p-6 text-slate-600">Loading…</p>;

  const queueBox = (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="offline-queue">
      <h2 className="font-display text-lg font-bold">Sales waiting to send: {queue.length}</h2>
      {queue.length === 0 ? <p className="mt-1 text-sm text-slate-600">Nothing waiting. Every sale made here has reached Leaf2Sale.</p> : null}
      <ul className="mt-2 space-y-1 text-sm">
        {queue.map((q) => (
          <li key={q.sale.offlineId} className="flex flex-wrap justify-between gap-2">
            <span>
              {q.sale.localNumber} · {money(q.sale.total)}
            </span>
            {q.state === "failed" ? <span className="font-semibold text-red-700">Needs help: {q.error}</span> : <span className="text-slate-500">waiting</span>}
          </li>
        ))}
      </ul>
      {queue.some((q) => q.state === "waiting") ? (
        <button type="button" onClick={() => void send()} disabled={!online} className="mt-3 h-11 rounded-lg bg-brand-700 px-4 font-bold text-white disabled:opacity-50">
          Send now
        </button>
      ) : null}
      {summary?.stopped ? <p className="mt-2 text-sm font-semibold text-amber-800">{summary.stopped}</p> : null}
      {summary && summary.sent > 0 ? <p className="mt-2 text-sm font-semibold text-brand-800">{summary.sent} sent. Any that need a manager’s look appear under “To review”.</p> : null}
    </section>
  );

  const banner = (
    <p className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${online ? "bg-brand-100 text-brand-900" : "bg-amber-100 text-amber-900"}`} role="status" data-testid="offline-banner">
      <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />
      {online ? "You are back online. Sales made here are sent to Leaf2Sale." : "No internet. Cash sales are saved on this device and sent when the connection returns."}
    </p>
  );

  const outageNotice = online ? null : (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="outage-notice">
      <strong>If the state track-and-trace system is also down for your store:</strong> tell the Cannabis Control Division right away, and keep a written record of what you sold during the outage. This device logs when it went offline
      {openOutageStart() ? ` (since ${new Date(openOutageStart()!).toLocaleTimeString("en-US", { timeZone: snap?.timeZone })})` : ""}. Age, purchase limits and lab-test status are still checked on every sale here.
    </p>
  );

  if (!snap) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        {banner}
        <p className="rounded-xl bg-white p-5">
          This device has no saved copy of the menu yet. Open the register once while online (and set the store rules under Menu), then offline selling is ready.
        </p>
        {queueBox}
      </div>
    );
  }

  const menu = snap.menu;
  const cartItems: CartItem[] = menu.filter((m) => new Decimal(cart[m.id] || 0).gt(0)).map((m) => ({ item: m, quantity: new Decimal(cart[m.id]) }));
  const discount = snap.discounts.find((d) => d.id === discountId) ?? null;
  const priced = priceCart(snap, cartItems, customerType, discount?.percent ?? 0);
  const shown = menu.filter((m) => !search.trim() || `${m.name} ${m.sku}`.toLowerCase().includes(search.trim().toLowerCase()));
  const age = nowMs ? Math.max(0, Math.floor((nowMs - new Date(snap.savedAt).getTime()) / 3_600_000)) : 0;
  const setQty = (id: string, value: string) => {
    setError(null);
    setCart((c) => ({ ...c, [id]: value }));
  };

  const complete = () => {
    setError(null);
    try {
      const idProblem = checkIn(snap, { birthDate, idExpires, customerType });
      if (idProblem) throw new Error(idProblem);
      for (const c of cartItems) {
        if (c.quantity.gt(stockLeft(snap, c.item.id, queue))) throw new Error(`${c.item.name}: only ${stockLeft(snap, c.item.id, queue).toString()} left by this device’s count.`);
      }
      const sale = buildSale(snap, {
        cart: cartItems,
        customerType,
        birthDate,
        idExpires,
        idNumber,
        discount: discount ? { name: discount.name, percent: discount.percent } : null,
        cashTendered: cash,
        localNumber: nextLocalNumber(),
        queue,
      });
      if (!enqueue(sale)) throw new Error("This device could not save the sale (its storage is full or blocked). Do not hand over the product. Write the sale down and free up space.");
      setReceipt(sale);
      setCart({});
      setBirthDate("");
      setIdExpires("");
      setIdNumber("");
      setCash("");
      setDiscountId("");
      refresh();
      if (navigator.onLine) void send();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the sale.");
    }
  };

  if (receipt) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        {banner}
        {outageNotice}
        <section className="rounded-xl bg-white p-6 text-center" data-testid="offline-receipt">
          <h1 className="font-display text-2xl font-bold">Sale saved: {receipt.localNumber}</h1>
          <p className="mt-2 text-4xl font-extrabold">{money(receipt.total)}</p>
          <p className="mt-1 text-lg">Change due: {money(receipt.changeDue)}</p>
          <ul className="mt-3 text-sm text-slate-600">
            {receipt.lines.map((l) => (
              <li key={l.itemId}>
                {l.quantity} × {l.name}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setReceipt(null)} className="mt-5 h-12 rounded-lg bg-brand-700 px-6 text-lg font-bold text-white">
            Next customer
          </button>
        </section>
        {queueBox}
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_380px]" style={{ maxHeight: "100%" }}>
      <div className="space-y-3 lg:col-span-2">
        {banner}
        {outageNotice}
        {age >= 24 ? <p className="text-sm font-semibold text-amber-800">The menu on this device was saved {Math.floor(age / 24)} day(s) ago. Prices or stock may have changed. Connect when you can.</p> : null}
        {snap.receiptWarning ? <p className="text-sm text-slate-600">{snap.receiptWarning}</p> : null}
      </div>
      <section className="space-y-2">
        <input className={field} placeholder="Search the menu" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the menu" />
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {shown.map((m) => {
            const left = stockLeft(snap, m.id, queue);
            return (
              <li key={m.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{m.name}</p>
                  <p className="text-sm text-slate-600">
                    {money(m.price)} · {left.toString()} {m.unitLabel} left
                  </p>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className="h-11 w-24 rounded-lg border border-slate-300 px-2 text-right text-base"
                  aria-label={`Quantity of ${m.name}`}
                  value={cart[m.id] ?? ""}
                  onChange={(e) => setQty(m.id, e.target.value)}
                  disabled={left.lte(0)}
                />
                <button type="button" className="h-11 rounded-lg bg-brand-100 px-3 font-bold text-brand-900 disabled:opacity-40" disabled={left.lte(0)} onClick={() => setQty(m.id, new Decimal(cart[m.id] || 0).add(1).toString())}>
                  +1
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-display text-lg font-bold">This customer</h2>
        <label className="block text-sm font-semibold">
          Customer
          <select className={field} value={customerType} onChange={(e) => setCustomerType(e.target.value as "ADULT_USE" | "MEDICAL")}>
            <option value="ADULT_USE">Adult-use</option>
            <option value="MEDICAL">Medical patient</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm font-semibold">
            Date of birth
            <input type="date" className={field} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">
            ID expires
            <input type="date" className={field} value={idExpires} onChange={(e) => setIdExpires(e.target.value)} />
          </label>
        </div>
        {snap.settings.dailyLimits ? (
          <label className="block text-sm font-semibold">
            ID number
            <input className={field} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} autoComplete="off" />
            <span className="mt-1 block text-xs font-normal text-slate-600">This store counts limits per customer per day. The number is kept as a scrambled code once the sale is sent.</span>
          </label>
        ) : null}
        {snap.discounts.length > 0 ? (
          <label className="block text-sm font-semibold">
            Discount
            <select className={field} value={discountId} onChange={(e) => setDiscountId(e.target.value)}>
              <option value="">None</option>
              {snap.discounts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.percent}%)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(priced.subtotal)}</dd></div>
          {priced.discount.gt(0) ? <div className="flex justify-between"><dt>Discount</dt><dd>−{money(priced.discount)}</dd></div> : null}
          <div className="flex justify-between"><dt>Taxes</dt><dd>{money(priced.exciseTax.add(priced.salesTax))}</dd></div>
          <div className="flex justify-between text-xl font-extrabold"><dt>Total</dt><dd data-testid="offline-total">{money(priced.total)}</dd></div>
        </dl>
        {priced.problem ? <p className="text-sm font-semibold text-red-700">{priced.problem}</p> : null}
        <label className="block text-sm font-semibold">
          Cash handed over
          <input type="number" inputMode="decimal" min="0" step="0.01" className={field} value={cash} onChange={(e) => setCash(e.target.value)} />
        </label>
        {error ? <p role="alert" className="text-sm font-semibold text-red-700" data-testid="offline-error">{error}</p> : null}
        <button type="button" onClick={complete} disabled={cartItems.length === 0} className="h-12 w-full rounded-lg bg-brand-700 text-lg font-bold text-white disabled:opacity-50">
          Complete cash sale
        </button>
      </section>
      <div className="lg:col-span-2">{queueBox}</div>
    </div>
  );
}
