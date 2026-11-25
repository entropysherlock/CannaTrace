/**
 * The Apex reference ledger. It is written separately from CannaTrace and shares no calculation code with it:
 * money is whole cents and quantities are whole ten-thousandths (BigInt), so there is no floating point and no
 * Decimal library. The ledger only ever records what SHOULD have happened; it is never adjusted to match the app.
 */
export const U = 10_000n; // quantity units per 1.0000
export const units = (v: number | string): bigint => {
  const [w, f = ""] = String(v).split(".");
  return BigInt(w) * U + BigInt((f + "0000").slice(0, 4));
};
export const unitsToString = (u: bigint): string => {
  const neg = u < 0n;
  const a = neg ? -u : u;
  return `${neg ? "-" : ""}${a / U}.${String(a % U).padStart(4, "0")}`;
};
export const centsToString = (c: bigint): string => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
};
/** Round-half-up integer division for non-negative numerator. */
export const divRound = (num: bigint, den: bigint): bigint => (num * 2n + den) / (den * 2n);

export type Rates = { exciseMilli: bigint; salesMilli: bigint; medicalExempt: boolean }; // percent * 1000
export type LedgerLine = { itemId: string; qty: bigint; priceCents: bigint }; // qty whole units
export type SaleCalc = { subtotal: bigint; discount: bigint; excise: bigint; salesTax: bigint; total: bigint };

/** Independent sale arithmetic: discount on the subtotal, then each tax on what remains, each rounded to the cent. */
export function priceSale(lines: LedgerLine[], discountPct: bigint, rates: Rates, medical: boolean): SaleCalc {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.priceCents, 0n);
  const discount = divRound(subtotal * discountPct, 100n);
  const taxable = subtotal - discount;
  const exempt = medical && rates.medicalExempt;
  const excise = exempt ? 0n : divRound(taxable * rates.exciseMilli, 100_000n);
  const salesTax = exempt ? 0n : divRound(taxable * rates.salesMilli, 100_000n);
  return { subtotal, discount, excise, salesTax, total: taxable + excise + salesTax };
}

export type SaleRec = { key: string; fac: string; calc: SaleCalc; lines: LedgerLine[]; cashKept: bigint; debit: bigint; refunded: bigint; voided: boolean; drawer: string; offline: boolean };

export class Ledger {
  plants = { tagged: 0, harvested: 0, destroyed: 0 };
  harvests = new Map<string, { wet: bigint; dry: bigint; waste: bigint; packaged: bigint }>();
  /** facility:item -> units on hand (sellable or not, excluding finished) */
  stock = new Map<string, bigint>();
  sales = new Map<string, SaleRec>();
  transfers = { outUnits: 0n, inUnits: 0n, count: 0 };
  wholesaleCents = 0n;
  wholesalePaidCents = 0n;
  drawerVariance = new Map<string, bigint>();
  counters = { packagesMade: 0, restocks: 0, returns: 0, voids: 0, offlineSales: 0, rejectedAttempts: 0 };

  stockOf(fac: string, item: string) { return this.stock.get(`${fac}:${item}`) ?? 0n; }
  addStock(fac: string, item: string, delta: bigint) {
    const k = `${fac}:${item}`;
    const v = (this.stock.get(k) ?? 0n) + delta;
    if (v < 0n) throw new Error(`ledger stock went negative for ${k}`);
    this.stock.set(k, v);
  }

  recordSale(rec: SaleRec) {
    this.sales.set(rec.key, rec);
    for (const l of rec.lines) this.addStock(rec.fac, l.itemId, -l.qty * U);
  }
  voidSale(key: string) {
    const s = this.sales.get(key)!;
    if (s.voided) throw new Error("ledger: double void");
    s.voided = true;
    for (const l of s.lines) this.addStock(s.fac, l.itemId, l.qty * U);
    this.counters.voids++;
  }
  /** Refund share of a return: total * returned value / subtotal, rounded half up; the last return takes what is left. */
  refundFor(key: string, returned: { itemId: string; qty: bigint }[], isLast: boolean): bigint {
    const s = this.sales.get(key)!;
    const value = returned.reduce((sum, r) => sum + r.qty * s.lines.find((l) => l.itemId === r.itemId)!.priceCents, 0n);
    const remaining = s.calc.total - s.refunded;
    if (isLast) return remaining;
    if (s.calc.subtotal === 0n) return 0n;
    const share = divRound(s.calc.total * value, s.calc.subtotal);
    return share < remaining ? share : remaining;
  }

  /** Totals for one facility, over sales that count (completed, not voided). */
  salesTotals(fac: string) {
    const t = { count: 0, subtotal: 0n, discount: 0n, excise: 0n, salesTax: 0n, total: 0n, refunded: 0n, cash: 0n, debit: 0n };
    for (const s of this.sales.values()) {
      if (s.fac !== fac || s.voided) continue;
      t.count++;
      t.subtotal += s.calc.subtotal; t.discount += s.calc.discount; t.excise += s.calc.excise; t.salesTax += s.calc.salesTax; t.total += s.calc.total;
      t.refunded += s.refunded; t.cash += s.cashKept; t.debit += s.debit;
    }
    return t;
  }

  serialize() {
    const rep = (_: string, v: unknown) => (typeof v === "bigint" ? { $big: v.toString() } : v instanceof Map ? { $map: [...v.entries()] } : v);
    return JSON.stringify(this, rep);
  }
  static fromJSON(text: string): Ledger {
    const rev = (_: string, v: unknown): unknown => {
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("$big" in o) return BigInt(o.$big as string);
        if ("$map" in o) return new Map(o.$map as [string, unknown][]);
      }
      return v;
    };
    return Object.assign(new Ledger(), JSON.parse(text, rev));
  }
}
