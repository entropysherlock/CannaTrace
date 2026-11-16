import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { InventoryError } from "../src/lib/inventory-math";
import { inputCost, parseBatches, scaleRecipe, unitCost, weightLoss, yieldPercent } from "../src/lib/manufacturing-math";

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
  it("rounds cost per unit to four places", () => {
    expect(unitCost(new Decimal(100), new Decimal(0), new Decimal(3))!.toString()).toBe("33.3333");
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
