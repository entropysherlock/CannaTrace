import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { expandTags, harvestOnHand, parseTagList, takeFromHarvest, toGrams } from "../src/lib/cultivation-math";
import { InventoryError } from "../src/lib/inventory-math";

describe("expandTags", () => {
  it("counts up and keeps leading zeros", () => {
    expect(expandTags("pl-0098", 3)).toEqual(["PL-0098", "PL-0099", "PL-0100"]);
  });
  it("handles very long tag numbers exactly", () => {
    expect(expandTags("1A4FF0100000022000009999", 2)[1]).toBe("1A4FF0100000022000010000");
  });
  it("allows a single tag without a number", () => {
    expect(expandTags("MOTHER-A", 1)).toEqual(["MOTHER-A"]);
  });
  it("refuses a run that would overflow the number width", () => {
    expect(() => expandTags("PL-98", 3)).toThrow(/run out/);
  });
  it("refuses a run from a tag with no number, bad counts, and huge runs", () => {
    expect(() => expandTags("MOTHER-A", 2)).toThrow(InventoryError);
    expect(() => expandTags("PL-001", 0)).toThrow(InventoryError);
    expect(() => expandTags("PL-001", 1.5)).toThrow(InventoryError);
    expect(() => expandTags("PL-0001", 501)).toThrow(/at most 500/);
  });
});

describe("parseTagList", () => {
  it("splits on spaces, commas, and new lines", () => {
    expect(parseTagList("pl-001, pl-002\nPL-003  ")).toEqual(["PL-001", "PL-002", "PL-003"]);
  });
  it("rejects duplicates and empty input", () => {
    expect(() => parseTagList("PL-001 pl-001")).toThrow(/listed twice/);
    expect(() => parseTagList("  ")).toThrow(InventoryError);
  });
});

describe("toGrams", () => {
  it("converts weight units", () => {
    expect(toGrams("2", "KG").toString()).toBe("2000");
    expect(toGrams("1", "LB").toString()).toBe("453.5924");
  });
  it("rejects non-weight units and bad numbers", () => {
    expect(() => toGrams("1", "EACH")).toThrow(/weight unit/);
    expect(() => toGrams("1", "ML")).toThrow(/weight unit/);
    expect(() => toGrams("-1", "G")).toThrow(InventoryError);
  });
});

describe("harvest weight on hand", () => {
  const base = { wetWeight: "1000", dryWeight: null, wasteWeight: "50", packagedWeight: "100" };
  it("uses wet weight until a dry weight is recorded", () => {
    expect(harvestOnHand(base).toString()).toBe("850");
    expect(harvestOnHand({ ...base, dryWeight: "250" }).toString()).toBe("100");
  });
  it("never lets more leave than is there", () => {
    expect(takeFromHarvest(new Decimal(100), new Decimal(100), "The package").toString()).toBe("0");
    expect(() => takeFromHarvest(new Decimal(100), new Decimal("100.0001"), "The package")).toThrow(/only 100 g/);
  });
});
