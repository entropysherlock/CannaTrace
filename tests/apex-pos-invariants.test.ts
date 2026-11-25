import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { cartTotals, settlePayment, expectedCash } from "../src/lib/pos-math";

describe("Project Apex: deterministic financial reconciliation", () => {
  it("reconciles 365 days of synthetic cash and split payments against integer-cent oracle", () => {
    let seed = 20261124;
    const next = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const dollars = (cents: number) => new Decimal(cents).div(100);
    const roundPct = (cents: number, pct: number) => Math.floor((cents * pct + 50) / 100);
    for (let day = 0; day < 365; day++) {
      const opening = 20000;
      let expected = opening;
      const kept: Decimal[] = [];
      for (let sale = 0; sale < 40; sale++) {
        const qty = 1 + next(10), price = 100 + next(10000), discount = next(31);
        const subtotal = qty * price;
        const taxable = subtotal - roundPct(subtotal, discount);
        const total = taxable + roundPct(taxable, 14) + roundPct(taxable, 7);
        const t = cartTotals([{ quantity: qty, unitPrice: dollars(price) }], {
          discountPercent: discount, exciseTaxPercent: 14, salesTaxPercent: 7, taxExempt: false,
        });
        expect(t.total.toFixed(2)).toBe(dollars(total).toFixed(2));
        const debit = sale % 2 === 0 && total > 1 ? Math.floor(total / 2) : 0;
        const cash = total - debit;
        const tender = cash + next(2000);
        const payment = settlePayment(t.total, debit ? "SPLIT" : "CASH", { cashTendered: dollars(tender), debit: dollars(debit) });
        expect(payment.cashKept.toFixed(2)).toBe(dollars(cash).toFixed(2));
        expect(payment.changeDue.toFixed(2)).toBe(dollars(tender - cash).toFixed(2));
        expect(payment.cashKept.add(payment.debit).eq(t.total)).toBe(true);
        expected += cash;
        kept.push(payment.cashKept);
      }
      expect(expectedCash(dollars(opening), kept).toFixed(2)).toBe(dollars(expected).toFixed(2));
    }
  });
});
