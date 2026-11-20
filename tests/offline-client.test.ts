import Decimal from "decimal.js";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSale, checkIn, enqueue, loadQueue, nextLocalNumber, pendingCount, priceCart, saveSnapshot, loadSnapshot, stockLeft, syncQueue, type CartItem, type KeyValueStore } from "@/lib/offline-client";
import type { OfflineSale, OfflineSnapshot } from "@/lib/offline-types";

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

const snap: OfflineSnapshot = {
  version: 1,
  savedAt: "2026-11-20T15:00:00.000Z",
  facilityId: "fac1",
  facilityName: "Shop",
  timeZone: "America/Denver",
  userId: "u1",
  userName: "Bud Tender",
  drawerId: "d1",
  settings: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true, adultMinAge: 21, medicalMinAge: 18, dailyLimits: false },
  limits: {
    ADULT_USE: { FLOWER: "56.7", CONCENTRATE: "16", EDIBLE: "800", combined: null },
    MEDICAL: { FLOWER: "226.8", CONCENTRATE: "60", EDIBLE: "2000", combined: null },
  },
  stateName: "New Mexico",
  menu: [
    { id: "papers", name: "Papers", sku: "P", category: "Other", unit: "EACH", unitLabel: "each", price: "2.00", limitCategory: "NONE", limitPerUnit: null, stock: "10" },
    { id: "jar", name: "Jar 3.5", sku: "J", category: "Flower", unit: "EACH", unitLabel: "each", price: "35.00", limitCategory: "FLOWER", limitPerUnit: "3.5", stock: "30" },
  ],
  discounts: [{ id: "v", name: "Veteran", percent: "10" }],
  receiptWarning: null,
};
const item = (id: string) => snap.menu.find((m) => m.id === id)!;
const cart = (id: string, q: number): CartItem[] => [{ item: item(id), quantity: new Decimal(q) }];

describe("offline register math", () => {
  it("prices a cart the way the online register does", () => {
    const p = priceCart(snap, cart("papers", 2), "ADULT_USE");
    expect([p.subtotal, p.exciseTax, p.salesTax, p.total].map((d) => d.toFixed(2))).toEqual(["4.00", "0.56", "0.31", "4.87"]);
    expect(p.problem).toBeNull();
    // Medical patients are tax exempt when the store says so; a discount comes off before tax.
    expect(priceCart(snap, cart("papers", 2), "MEDICAL").total.toFixed(2)).toBe("4.00");
    expect(priceCart(snap, cart("jar", 1), "ADULT_USE", "10").total.toFixed(2)).toBe("38.31");
  });

  it("stops a cart over the purchase limit, and states the state's combined cap", () => {
    expect(priceCart(snap, cart("jar", 16), "ADULT_USE").problem).toBeNull();
    expect(priceCart(snap, cart("jar", 17), "ADULT_USE").problem).toMatch(/59.5 g of flower. The limit is 56.7 g per purchase/);
    expect(priceCart(snap, cart("jar", 17), "MEDICAL").problem).toBeNull();
    const capped = { ...snap, limits: { ...snap.limits, ADULT_USE: { ...snap.limits.ADULT_USE, combined: "10" } } };
    expect(priceCart(capped, cart("jar", 4), "ADULT_USE").problem).toMatch(/New Mexico allows 10 g per purchase/);
  });

  it("checks the ID on the store's day, not the device's", () => {
    const now = new Date("2026-11-20T15:00:00Z");
    const adult = { customerType: "ADULT_USE" as const, birthDate: "1990-05-05", idExpires: "2030-01-01" };
    expect(checkIn(snap, adult, now)).toBeNull();
    expect(checkIn(snap, { ...adult, birthDate: "2006-01-01" }, now)).toMatch(/minimum age is 21/);
    expect(checkIn(snap, { ...adult, idExpires: "2026-11-19" }, now)).toMatch(/expired/);
    expect(checkIn(snap, { ...adult, birthDate: "" }, now)).toMatch(/Enter the date of birth/);
    // 21st birthday is tomorrow in Denver but already today in UTC late in the evening: the store's day wins.
    expect(checkIn(snap, { ...adult, birthDate: "2005-11-21" }, new Date("2026-11-21T03:00:00Z"))).toMatch(/minimum age is 21/);
    expect(checkIn(snap, { ...adult, birthDate: "2005-11-20" }, new Date("2026-11-21T03:00:00Z"))).toBeNull();
  });

  it("builds a sale only when the cash covers it", () => {
    const base = { cart: cart("papers", 2), customerType: "ADULT_USE" as const, birthDate: "1990-05-05", idExpires: "2030-01-01", discount: null, localNumber: "OFF-0001", now: new Date("2026-11-20T16:00:00Z") };
    expect(() => buildSale(snap, { ...base, cashTendered: "4.00" })).toThrow(/only \$4.00 was handed over/);
    expect(() => buildSale(snap, { ...base, cart: [] , cashTendered: "10" })).toThrow(/empty/);
    expect(() => buildSale(snap, { ...base, cart: cart("jar", 17), cashTendered: "999" })).toThrow(/limit/);
    const sale = buildSale(snap, { ...base, cashTendered: "10" });
    expect(sale).toMatchObject({ facilityId: "fac1", sellerId: "u1", drawerId: "d1", total: "4.87", cashTendered: "10.00", changeDue: "5.13", localNumber: "OFF-0001", soldAt: "2026-11-20T16:00:00.000Z" });
    expect(sale.offlineId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sale.lines).toEqual([{ itemId: "papers", name: "Papers", quantity: "2", unitPrice: "2.00" }]);
  });
});

describe("the queue on the device", () => {
  let kv: ReturnType<typeof memory>;
  const sale = (n: number): OfflineSale => ({
    offlineId: `00000000-0000-4000-8000-00000000000${n}`,
    localNumber: `OFF-000${n}`,
    facilityId: "fac1",
    sellerId: "u1",
    sellerName: "Bud",
    drawerId: "d1",
    soldAt: "2026-11-20T16:00:00.000Z",
    customerType: "ADULT_USE",
    birthDate: "1990-05-05",
    idExpires: "2030-01-01",
    lines: [{ itemId: "papers", name: "Papers", quantity: "3", unitPrice: "2.00" }],
    discount: null,
    total: "6.00",
    cashTendered: "10.00",
    changeDue: "4.00",
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    kv = memory();
  });

  it("keeps the saved copy, the queue and the receipt counter", () => {
    expect(loadSnapshot(kv)).toBeNull();
    saveSnapshot(snap, kv);
    expect(loadSnapshot(kv)?.facilityName).toBe("Shop");
    expect([nextLocalNumber(kv), nextLocalNumber(kv)]).toEqual(["OFF-0001", "OFF-0002"]);
    expect(enqueue(sale(1), kv)).toBe(true);
    expect(pendingCount(kv)).toBe(1);
    expect(loadQueue(kv)[0]).toMatchObject({ state: "waiting", attempts: 0 });
    // A device that cannot store anything says so instead of pretending the sale is safe.
    const broken: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(enqueue(sale(2), broken)).toBe(false);
  });

  it("counts waiting sales against what the saved copy says is left", () => {
    enqueue(sale(1), kv); // 3 papers waiting
    expect(stockLeft(snap, "papers", loadQueue(kv)).toString()).toBe("7");
    expect(stockLeft(snap, "jar", loadQueue(kv)).toString()).toBe("30");
    expect(stockLeft(snap, "nothing", [])).toEqual(new Decimal(0));
  });

  it("sends sales oldest first and removes each only after the server confirms it", async () => {
    enqueue(sale(1), kv);
    enqueue(sale(2), kv);
    const seen: string[] = [];
    const summary = await syncQueue(async (_url, init) => {
      seen.push(JSON.parse(String(init?.body)).localNumber);
      return json(200, { saleId: "s", number: "S-00001", flagged: false, duplicate: false });
    }, kv);
    expect(seen).toEqual(["OFF-0001", "OFF-0002"]);
    expect(summary).toMatchObject({ sent: 2, failed: 0, stopped: null, waiting: 0 });
    expect(loadQueue(kv)).toHaveLength(0);
  });

  it("keeps everything when there is no internet, or the person is signed out", async () => {
    enqueue(sale(1), kv);
    let s = await syncQueue(async () => { throw new TypeError("Failed to fetch"); }, kv);
    expect(s).toMatchObject({ sent: 0, waiting: 1 });
    expect(s.stopped).toMatch(/safe on this device/);
    s = await syncQueue(async () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }), kv);
    expect(s.stopped).toMatch(/sign in again/);
    s = await syncQueue(async () => json(401, { error: "Please sign in again." }), kv);
    expect(s.stopped).toMatch(/sign in/i);
    s = await syncQueue(async () => json(500, { error: "Something went wrong" }), kv);
    expect(s.stopped).toBeTruthy();
    expect(loadQueue(kv)).toHaveLength(1);
    expect(loadQueue(kv)[0].state).toBe("waiting");
  });

  it("waits for a drawer or the right store, but parks a sale the server can never take", async () => {
    enqueue(sale(1), kv);
    enqueue(sale(2), kv);
    let s = await syncQueue(async () => json(422, { error: "Open your cash drawer, then sync again." }), kv);
    expect(s).toMatchObject({ sent: 0, failed: 0, waiting: 2 });
    // First sale is unusable; the second still goes through.
    let call = 0;
    s = await syncQueue(async () => (++call === 1 ? json(422, { error: "That offline sale is more than 14 days old." }) : json(200, { saleId: "s", number: "S-1", flagged: true, duplicate: false })), kv);
    expect(s).toMatchObject({ sent: 1, failed: 1, waiting: 0 });
    const left = loadQueue(kv);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ state: "failed", error: expect.stringMatching(/14 days/), attempts: 1 });
    // A parked sale is never silently dropped or retried forever.
    s = await syncQueue(async () => { throw new Error("should not be called"); }, kv);
    expect(s.sent).toBe(0);
  });
});
