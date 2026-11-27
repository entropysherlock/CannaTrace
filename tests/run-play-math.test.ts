import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { pickOldestFirst, type StockPackage } from "@/lib/run-play-math";

const pkg = (id: string, itemId: string, quantity: number, day: number): StockPackage => ({ id, tag: `T-${id}`, itemId, quantity, unit: "GRAMS", createdAt: new Date(2026, 0, day) });
describe("pickOldestFirst", () => {
  it("uses the oldest package first and spills into the next", () => {
    const { picks, short } = pickOldestFirst(new Map([["flower", new Decimal(150)]]), [pkg("new", "flower", 100, 9), pkg("old", "flower", 100, 1)]);
    expect(picks.map((p) => [p.packageId, p.quantity.toNumber()])).toEqual([["old", 100], ["new", 50]]);
    expect(short).toEqual([]);
  });
  it("reports what is short instead of guessing", () => {
    const { picks, short } = pickOldestFirst(new Map([["flower", new Decimal(500)]]), [pkg("a", "flower", 120, 1)]);
    expect(picks).toHaveLength(1);
    expect(short[0].short.toNumber()).toBe(380);
    expect(short[0].available.toNumber()).toBe(120);
  });
  it("handles several items and ignores empty or other-item packages", () => {
    const { picks, short } = pickOldestFirst(new Map([["a", new Decimal(10)], ["b", new Decimal(5)]]), [pkg("1", "a", 0, 1), pkg("2", "a", 10, 2), pkg("3", "b", 5, 1), pkg("4", "c", 99, 1)]);
    expect(picks.map((p) => p.packageId).sort()).toEqual(["2", "3"]);
    expect(short).toEqual([]);
  });
  it("reports an item with no stock at all", () => {
    expect(pickOldestFirst(new Map([["a", new Decimal(1)]]), []).short[0].short.toNumber()).toBe(1);
  });
});
