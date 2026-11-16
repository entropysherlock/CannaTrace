import { describe, expect, it } from "vitest";
import { InventoryError, applyDelta, parsePositiveQty, planSplit } from "../src/lib/inventory-math";

describe("parsePositiveQty", () => {
  it("accepts positive numbers and trims", () => {
    expect(parsePositiveQty(" 12.5 ").toString()).toBe("12.5");
  });
  it.each(["", "abc", "0", "-3", "Infinity", "NaN"])("rejects %j", (input) => {
    expect(() => parsePositiveQty(input)).toThrow(InventoryError);
  });
});

describe("applyDelta", () => {
  it("adds and subtracts exactly", () => {
    expect(applyDelta("0.1", "0.2").after.toString()).toBe("0.3");
    expect(applyDelta("100", "-99.9999").after.toString()).toBe("0.0001");
  });
  it("allows going to exactly zero", () => {
    expect(applyDelta("28", "-28").after.isZero()).toBe(true);
  });
  it("never lets stock go negative", () => {
    expect(() => applyDelta("5", "-5.0001")).toThrow(/Not enough stock/);
  });
});

describe("planSplit", () => {
  it("returns what is left in the source package", () => {
    const plan = planSplit("100", ["30", "30", "30"]);
    expect(plan.total.toString()).toBe("90");
    expect(plan.remaining.toString()).toBe("10");
  });
  it("allows splitting the whole package", () => {
    expect(planSplit("7", ["3.5", "3.5"]).remaining.isZero()).toBe(true);
  });
  it("rejects splitting more than the package holds", () => {
    expect(() => planSplit("7", ["3.5", "3.6"])).toThrow(/only holds/);
  });
  it("rejects empty and non-positive parts", () => {
    expect(() => planSplit("7", [])).toThrow(InventoryError);
    expect(() => planSplit("7", ["0"])).toThrow(InventoryError);
  });
});
