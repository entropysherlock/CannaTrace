import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { InventoryError } from "../src/lib/inventory-math";
import { inputCost, parseBatches, scaleRecipe, suggestRunName, summarizeRuns, unitCost, weightLoss, yieldPercent, type RunSummaryInput } from "../src/lib/manufacturing-math";

describe("recipe scaling", () => {
  it("scales inputs and output by the number of batches", () => {
    const { plannedOutput, needs } = scaleRecipe(
      { outputQuantity: "100", lines: [{ itemId: "flower", quantity: "350" }, { itemId: "jar", quantity: "100" }] },
      parseBatches("2.5"),
    );
    expect(plannedOutput.toString()).toBe("250");
    expect(needs.get("flower")!.toString()).toBe("875");
    expect(needs.get("jar")!.toString()).toBe("250");
  });
  it.each(["", "0", "-1", "abc", "10001"])("rejects %j batches", (value) => {
    expect(() => parseBatches(value)).toThrow(InventoryError);
  });
});

describe("cost rollup", () => {
  it("adds up input costs and spreads them over the output", () => {
    const total = inputCost([
      { quantity: "350", costPerUnit: "1.2" },
      { quantity: "100", costPerUnit: "0.35" },
    ]);
    expect(total!.toString()).toBe("455");
    expect(unitCost(total, new Decimal(45), new Decimal(100))!.toString()).toBe("5");
  });
  it("is unknown when any input has no cost, rather than a misleading partial total", () => {
    const total = inputCost([{ quantity: "350", costPerUnit: "1.2" }, { quantity: "100", costPerUnit: null }]);
    expect(total).toBeNull();
    expect(unitCost(total, new Decimal(45), new Decimal(100))).toBeNull();
  });
  it("keeps cost per unit to eight places (APEX-16)", () => {
    expect(unitCost(new Decimal(100), new Decimal(0), new Decimal(3))!.toString()).toBe("33.33333333");
  });
});

describe("yield and loss", () => {
  it("reports yield against plan", () => {
    expect(yieldPercent("96", "100")!.toString()).toBe("96");
    expect(yieldPercent("1", "3")!.toString()).toBe("33.3");
    expect(yieldPercent("5", "0")).toBeNull();
  });
  it("measures weight loss across units", () => {
    const loss = weightLoss([{ quantity: "1", unit: "KG" }, { quantity: "250", unit: "G" }], { quantity: "1.1", unit: "KG" });
    expect(loss!.toString()).toBe("150");
  });
  it("has no weight loss figure when counts are involved", () => {
    expect(weightLoss([{ quantity: "350", unit: "G" }], { quantity: "100", unit: "EACH" })).toBeNull();
    expect(weightLoss([{ quantity: "100", unit: "EACH" }], { quantity: "1", unit: "KG" })).toBeNull();
  });
});

describe("the Manufacturing overview numbers", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const run = (o: Partial<RunSummaryInput>): RunSummaryInput => ({ status: "COMPLETED", plannedOutput: 100, actualOutput: 100, inputCost: null, extraCost: null, completedAt: now, ...o });
  it("counts runs in progress and finished this month, averages recent yield, and totals this month's cost", () => {
    const s = summarizeRuns(
      [
        run({ status: "IN_PROGRESS", actualOutput: null, completedAt: null }),
        run({ actualOutput: 98, inputCost: "400", extraCost: "25.5" }),
        run({ actualOutput: 90, inputCost: "100" }),
        run({ actualOutput: 50, completedAt: new Date("2026-03-01T00:00:00Z") }), // too old for the yield average
        run({ status: "CANCELLED", actualOutput: null, completedAt: null }),
      ],
      now,
    );
    expect(s).toMatchObject({ inProgress: 1, completedThisMonth: 2, yieldRuns: 2 });
    expect(s.averageYield?.toString()).toBe("94");
    expect(s.costThisMonth?.toString()).toBe("525.5");
  });
  it("leaves yield and cost blank when there's nothing to go on", () => {
    expect(summarizeRuns([], now)).toMatchObject({ inProgress: 0, completedThisMonth: 0, averageYield: null, costThisMonth: null });
  });
  it("suggests the next free run name for the day, in Mountain time", () => {
    const late = new Date("2026-11-19T05:30:00Z"); // 10:30 pm on the 18th in Albuquerque
    expect(suggestRunName([], late)).toBe("RUN-20261118-01");
    expect(suggestRunName(["run-20261118-01", "RUN-20261118-02"], late)).toBe("RUN-20261118-03");
  });
});

describe("over-yield guard", () => {
  it("refuses a probable typo, wants a note above 120%, and leaves normal yields alone", async () => {
    const { checkYield } = await import("../src/lib/manufacturing");
    const D = (await import("decimal.js")).default;
    expect(() => checkYield(new D(2200), 100)).toThrow(/extra digit/);
    expect(() => checkYield(new D(150), 100)).toThrow(/Add a note/);
    expect(() => checkYield(new D(150), 100, "Rehydrated, weighed wet")).not.toThrow();
    expect(() => checkYield(new D(96), 100)).not.toThrow();
  });
  it("keeps absurd yields out of the average", () => {
    const now = new Date();
    const run = (actual: string) => ({ status: "COMPLETED" as const, plannedOutput: "100", actualOutput: actual, inputCost: null, extraCost: null, completedAt: now });
    expect(summarizeRuns([run("100"), run("2200")], now).averageYield?.toString()).toBe("100");
  });
});
