import { describe, expect, it } from "vitest";
import { costBreakdown, parseCostAmount, parseCostKind } from "@/lib/run-costs-math";

describe("costBreakdown", () => {
  it("groups inputs by category and lists each other cost, with shares", () => {
    const b = costBreakdown(
      [
        { category: "Flower", quantity: 100, costPerUnit: "2" },
        { category: "Packaging", quantity: 50, costPerUnit: "0.5" },
        { category: "Packaging", quantity: 50, costPerUnit: "0.5" },
      ],
      [{ kind: "LABOR", amount: 25 }],
    );
    expect(b.total.toNumber()).toBe(275);
    const by = Object.fromEntries(b.rows.map((r) => [r.label, r.amount.toNumber()]));
    expect(by).toEqual({ Flower: 200, Packaging: 50, Labor: 25 });
    expect(b.rows[0].label).toBe("Flower");
    expect(b.rows.find((r) => r.label === "Labor")?.share?.toNumber()).toBe(9.1);
    expect(b.uncosted).toBe(0);
  });
  it("counts inputs with no cost instead of treating them as free", () => {
    const b = costBreakdown([{ category: "Flower", quantity: 1, costPerUnit: null }], []);
    expect(b.uncosted).toBe(1);
    expect(b.total.toNumber()).toBe(0);
  });
});
describe("parsing", () => {
  it("accepts dollars and rejects junk", () => {
    expect(parseCostAmount("$1,250.50").toNumber()).toBe(1250.5);
    for (const bad of ["", "0", "-5", "abc", "1.234", "2000000"]) expect(() => parseCostAmount(bad)).toThrow();
  });
  it("only accepts known kinds", () => {
    expect(parseCostKind("LABOR")).toBe("LABOR");
    expect(() => parseCostKind("MAGIC")).toThrow();
  });
});
