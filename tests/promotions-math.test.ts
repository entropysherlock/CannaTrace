import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  applyPromotions,
  describePromo,
  isRunning,
  lineDiscount,
  type Promo,
  type PromoLine,
} from "@/lib/promotions-math";

const promo = (over: Partial<Promo> = {}): Promo => ({
  id: "p1",
  name: "Wax Wednesday",
  kind: "PERCENT",
  amount: 20,
  scope: "CATEGORY",
  categoryId: "wax",
  weekdays: [3],
  active: true,
  ...over,
});
const line = (over: Partial<PromoLine> = {}): PromoLine => ({
  id: "l1",
  itemId: "i1",
  categoryId: "wax",
  quantity: 2,
  unitPrice: "30.00",
  ...over,
});
const wed = { weekday: 3, minutes: 12 * 60, date: "2026-11-25" };

describe("when a promotion runs", () => {
  it("runs on its weekday only", () => {
    expect(isRunning(promo(), wed)).toBe(true);
    expect(isRunning(promo(), { ...wed, weekday: 4 })).toBe(false);
  });
  it("runs every day when no weekdays are picked", () => {
    expect(isRunning(promo({ weekdays: [] }), { ...wed, weekday: 0 })).toBe(
      true,
    );
  });
  it("respects a time window, including one past midnight", () => {
    const happy = promo({ startTime: "16:20", endTime: "19:00" });
    expect(isRunning(happy, { ...wed, minutes: 16 * 60 + 19 })).toBe(false);
    expect(isRunning(happy, { ...wed, minutes: 16 * 60 + 20 })).toBe(true);
    expect(isRunning(happy, { ...wed, minutes: 19 * 60 })).toBe(false);
    const late = promo({ startTime: "20:00", endTime: "02:00" });
    expect(isRunning(late, { ...wed, minutes: 23 * 60 })).toBe(true);
    expect(isRunning(late, { ...wed, minutes: 60 })).toBe(true);
    expect(isRunning(late, { ...wed, minutes: 12 * 60 })).toBe(false);
  });
  it("respects start and end dates, inclusive", () => {
    const p = promo({
      weekdays: [],
      startDate: "2026-11-25",
      endDate: "2026-11-27",
    });
    expect(isRunning(p, { ...wed, date: "2026-11-24" })).toBe(false);
    expect(isRunning(p, { ...wed, date: "2026-11-25" })).toBe(true);
    expect(isRunning(p, { ...wed, date: "2026-11-27" })).toBe(true);
    expect(isRunning(p, { ...wed, date: "2026-11-28" })).toBe(false);
  });
  it("never runs when switched off", () => {
    expect(isRunning(promo({ active: false }), wed)).toBe(false);
  });
});

describe("how much comes off", () => {
  it("takes a percent off the line", () => {
    expect(lineDiscount(promo(), line()).toFixed(2)).toBe("12.00");
  });
  it("takes dollars off each unit", () => {
    expect(
      lineDiscount(promo({ kind: "DOLLAR", amount: 5 }), line()).toFixed(2),
    ).toBe("10.00");
  });
  it("never makes a line free: at most 90% comes off", () => {
    expect(
      lineDiscount(promo({ kind: "PERCENT", amount: 100 }), line()).toFixed(2),
    ).toBe("54.00");
    expect(
      lineDiscount(promo({ kind: "DOLLAR", amount: 500 }), line()).toFixed(2),
    ).toBe("54.00");
  });
  it("gives nothing on a zero-price line", () => {
    expect(lineDiscount(promo(), line({ unitPrice: "0" })).toFixed(2)).toBe(
      "0.00",
    );
  });
});

describe("applying promotions to a cart", () => {
  it("only touches the lines in scope", () => {
    const r = applyPromotions(
      [line(), line({ id: "l2", categoryId: "flower" })],
      [promo()],
      wed,
    );
    expect(r.total.toFixed(2)).toBe("12.00");
    expect([...r.byLine.keys()]).toEqual(["l1"]);
    expect(r.names).toEqual(["Wax Wednesday"]);
  });
  it("applies the single best promotion to a line, not a pile-up", () => {
    const r = applyPromotions(
      [line()],
      [
        promo(),
        promo({ id: "p2", name: "Big deal", scope: "ALL", amount: 30 }),
        promo({ id: "p3", name: "Small", amount: 5 }),
      ],
      wed,
    );
    expect(r.total.toFixed(2)).toBe("18.00");
    expect(r.byLine.get("l1")?.promoName).toBe("Big deal");
    expect(r.names).toEqual(["Big deal"]);
  });
  it("matches one product by id", () => {
    const r = applyPromotions(
      [line(), line({ id: "l2", itemId: "i2" })],
      [promo({ scope: "ITEM", itemId: "i2", categoryId: null })],
      wed,
    );
    expect([...r.byLine.keys()]).toEqual(["l2"]);
  });
  it("does nothing outside its day", () => {
    expect(
      applyPromotions([line()], [promo()], {
        ...wed,
        weekday: 1,
      }).total.toFixed(2),
    ).toBe("0.00");
  });
  it("adds up penny-exact", () => {
    const r = applyPromotions(
      [line({ quantity: 3, unitPrice: "9.99" })],
      [promo({ amount: 15 })],
      wed,
    );
    expect(r.total).toEqual(new Decimal("4.50"));
  });
});

describe("describing a promotion", () => {
  it("reads like a sentence", () => {
    expect(
      describePromo({
        kind: "PERCENT",
        amount: 20,
        weekdays: [3],
        startTime: "16:20",
        endTime: null,
        startDate: null,
        endDate: null,
      }),
    ).toBe("20% off · Wed · from 4:20 PM");
    expect(
      describePromo({
        kind: "DOLLAR",
        amount: 5,
        weekdays: [],
        startTime: null,
        endTime: null,
        startDate: null,
        endDate: null,
      }),
    ).toBe("$5.00 off each · Every day");
  });
});
