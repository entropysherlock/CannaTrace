import Decimal from "decimal.js";
import { cartTotals, checkInProblem, changeDue, limitProblem, limitUsage, type Limits } from "./pos-math";
import type { OfflineMenuItem, OfflineSale, OfflineSnapshot } from "./offline-types";

/**
 * Everything the offline register does on the device. Pure functions and a small storage layer, with nothing
 * from the server, so it runs with no internet and can be tested without a browser.
 */

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SNAPSHOT_KEY = "ct-offline-snapshot";
const QUEUE_KEY = "ct-offline-queue";
const COUNTER_KEY = "ct-offline-counter";

export type QueuedSale = { sale: OfflineSale; state: "waiting" | "failed"; error?: string; attempts: number };

function store(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string, fallback: T, kv: KeyValueStore | null = store()): T {
  try {
    const raw = kv?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown, kv: KeyValueStore | null = store()): boolean {
  try {
    if (!kv) return false;
    kv.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSnapshot = (kv?: KeyValueStore | null): OfflineSnapshot | null => {
  const snap = read<OfflineSnapshot | null>(SNAPSHOT_KEY, null, kv);
  return snap && snap.version === 1 ? snap : null;
};
export const saveSnapshot = (snap: OfflineSnapshot, kv?: KeyValueStore | null) => write(SNAPSHOT_KEY, snap, kv);

export const loadQueue = (kv?: KeyValueStore | null): QueuedSale[] => {
  const q = read<QueuedSale[]>(QUEUE_KEY, [], kv);
  return Array.isArray(q) ? q : [];
};
const saveQueue = (q: QueuedSale[], kv?: KeyValueStore | null) => write(QUEUE_KEY, q, kv);

/** Put a finished sale in the queue. Returns false when the device could not keep it (storage full or blocked). */
export function enqueue(sale: OfflineSale, kv?: KeyValueStore | null): boolean {
  const q = loadQueue(kv);
  q.push({ sale, state: "waiting", attempts: 0 });
  return saveQueue(q, kv);
}

export const pendingCount = (kv?: KeyValueStore | null) => loadQueue(kv).length;

/** The next receipt number on this device, shown until the real sale number exists. */
export function nextLocalNumber(kv?: KeyValueStore | null): string {
  const n = read<number>(COUNTER_KEY, 0, kv) + 1;
  write(COUNTER_KEY, n, kv);
  return `OFF-${String(n).padStart(4, "0")}`;
}

export const newOfflineId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/** The store's day (YYYY-MM-DD) for a moment, using the store's time zone, not the device's. */
export const dayIn = (when: Date, timeZone: string): string => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);

export type CartItem = { item: OfflineMenuItem; quantity: Decimal };

/** What the offline copy says is left of an item, after the offline sales already waiting in the queue. */
export function stockLeft(snap: OfflineSnapshot, itemId: string, queue: QueuedSale[]): Decimal {
  const item = snap.menu.find((m) => m.id === itemId);
  if (!item) return new Decimal(0);
  const sold = queue
    // Every waiting sale counts: none of them has reached the server yet, so none is in the saved stock figure.
    .filter((q) => q.sale.facilityId === snap.facilityId)
    .reduce((sum, q) => sum.add(q.sale.lines.filter((l) => l.itemId === itemId).reduce((s, l) => s.add(l.quantity), new Decimal(0))), new Decimal(0));
  return Decimal.max(0, new Decimal(item.stock).sub(sold));
}

/** Why this customer cannot be served, or null. Uses the store's day, so a tablet with the wrong date still checks correctly. */
export function checkIn(snap: OfflineSnapshot, input: { birthDate: string; idExpires: string; customerType: "ADULT_USE" | "MEDICAL" }, now = new Date()): string | null {
  if (!input.birthDate || !input.idExpires) return "Enter the date of birth and expiry date from the ID.";
  return checkInProblem(input, { adultMinAge: snap.settings.adultMinAge, medicalMinAge: snap.settings.medicalMinAge }, dayIn(now, snap.timeZone));
}

export type Priced = {
  subtotal: Decimal;
  discount: Decimal;
  exciseTax: Decimal;
  salesTax: Decimal;
  total: Decimal;
  exempt: boolean;
  usage: Limits;
  limits: { FLOWER: Decimal; CONCENTRATE: Decimal; EDIBLE: Decimal };
  /** The purchase limit this cart breaks, or null. */
  problem: string | null;
};

/** Totals and the purchase-limit check for a cart, the same way the online register works them out. */
export function priceCart(snap: OfflineSnapshot, cart: CartItem[], customerType: "ADULT_USE" | "MEDICAL", discountPercent: Decimal.Value = 0): Priced {
  const exempt = customerType === "MEDICAL" && snap.settings.medicalTaxExempt;
  const lines = cart.map((c) => ({ quantity: c.quantity, unitPrice: c.item.price, limitCategory: c.item.limitCategory, limitPerUnit: c.item.limitPerUnit }));
  const totals = cartTotals(lines, { discountPercent, exciseTaxPercent: snap.settings.exciseTaxPercent, salesTaxPercent: snap.settings.salesTaxPercent, taxExempt: exempt });
  const l = snap.limits[customerType];
  const limits = { FLOWER: new Decimal(l.FLOWER), CONCENTRATE: new Decimal(l.CONCENTRATE), EDIBLE: new Decimal(l.EDIBLE) };
  const usage = limitUsage(lines);
  let problem = limitProblem(usage, limits);
  if (!problem && l.combined && usage.FLOWER.add(usage.CONCENTRATE).gt(l.combined)) {
    problem = `That puts the cart at ${usage.FLOWER.add(usage.CONCENTRATE).toString()} g of flower and concentrate together. ${snap.stateName ?? "The state"} allows ${l.combined} g per purchase.`;
  }
  return { subtotal: totals.subtotal, discount: totals.discount, exciseTax: totals.exciseTax, salesTax: totals.salesTax, total: totals.total, exempt, usage, limits, problem };
}

/** Turn a finished cart and cash payment into a queued sale. Throws a plain message when the cash does not cover it. */
export function buildSale(
  snap: OfflineSnapshot,
  input: {
    cart: CartItem[];
    customerType: "ADULT_USE" | "MEDICAL";
    birthDate: string;
    idExpires: string;
    discount: { name: string; percent: string } | null;
    cashTendered: string;
    localNumber: string;
    now?: Date;
  },
): OfflineSale {
  if (input.cart.length === 0) throw new Error("The cart is empty.");
  const priced = priceCart(snap, input.cart, input.customerType, input.discount?.percent ?? 0);
  if (priced.problem) throw new Error(priced.problem);
  const tendered = new Decimal(input.cashTendered || 0);
  const change = changeDue(priced.total, tendered);
  return {
    offlineId: newOfflineId(),
    localNumber: input.localNumber,
    facilityId: snap.facilityId,
    sellerId: snap.userId,
    sellerName: snap.userName,
    drawerId: snap.drawerId,
    soldAt: (input.now ?? new Date()).toISOString(),
    customerType: input.customerType,
    birthDate: input.birthDate,
    idExpires: input.idExpires,
    lines: input.cart.map((c) => ({ itemId: c.item.id, name: c.item.name, quantity: c.quantity.toString(), unitPrice: c.item.price })),
    discount: input.discount,
    total: priced.total.toFixed(2),
    cashTendered: tendered.toFixed(2),
    changeDue: change.toFixed(2),
  };
}

export type SyncSummary = { sent: number; failed: number; stopped: string | null; waiting: number };

let syncing = false;

/**
 * Send every waiting sale to the server, oldest first. A sale leaves the queue only after the server confirms it.
 * Trouble that might pass (no internet, signed out, no open drawer, wrong store) stops the run and leaves everything
 * queued; a sale the server says it can never accept is kept and marked so a person can deal with it.
 */
export async function syncQueue(fetcher: typeof fetch = fetch, kv?: KeyValueStore | null): Promise<SyncSummary> {
  if (syncing) return { sent: 0, failed: 0, stopped: null, waiting: pendingCount(kv) };
  syncing = true;
  let sent = 0;
  let failed = 0;
  let stopped: string | null = null;
  try {
    for (;;) {
      const queue = loadQueue(kv);
      const index = queue.findIndex((q) => q.state === "waiting");
      if (index < 0) break;
      const entry = queue[index];
      let response: Response;
      try {
        response = await fetcher("/api/offline/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry.sale), credentials: "same-origin" });
      } catch {
        stopped = "No internet yet. Your sales are safe on this device.";
        break;
      }
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("application/json")) {
        stopped = "Please sign in again, then your sales will send.";
        break;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        const fresh = loadQueue(kv);
        saveQueue(fresh.filter((q) => q.sale.offlineId !== entry.sale.offlineId), kv);
        sent++;
        continue;
      }
      const message = body.error ?? "The server could not take this sale.";
      // These pass with a little help (a drawer, the right store, signing in), so keep trying later.
      if (response.status === 401 || response.status >= 500 || /Open your cash drawer|different store/i.test(message)) {
        stopped = message;
        break;
      }
      const fresh = loadQueue(kv).map((q) => (q.sale.offlineId === entry.sale.offlineId ? { ...q, state: "failed" as const, error: message, attempts: q.attempts + 1 } : q));
      saveQueue(fresh, kv);
      failed++;
    }
  } finally {
    syncing = false;
  }
  return { sent, failed, stopped, waiting: loadQueue(kv).filter((q) => q.state === "waiting").length };
}

/** Download the saved copy again while online. Keeps the old copy when the request fails. */
export async function refreshSnapshot(fetcher: typeof fetch = fetch, kv?: KeyValueStore | null): Promise<OfflineSnapshot | null> {
  try {
    const res = await fetcher("/api/offline/snapshot", { credentials: "same-origin", cache: "no-store" });
    if (!(res.headers.get("content-type") ?? "").includes("application/json") || !res.ok) return loadSnapshot(kv);
    const body = (await res.json()) as { snapshot: OfflineSnapshot | null };
    if (body.snapshot) saveSnapshot(body.snapshot, kv);
    return body.snapshot ?? loadSnapshot(kv);
  } catch {
    return loadSnapshot(kv);
  }
}
