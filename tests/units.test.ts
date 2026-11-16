import { describe, expect, it } from "vitest";
import { canConvert, convert, formatQty, roundQty } from "../src/lib/units";

describe("unit conversion", () => {
  it("converts within weight", () => {
    expect(convert(1, "KG", "G").toString()).toBe("1000");
    expect(convert(500, "MG", "G").toString()).toBe("0.5");
    expect(convert(1, "LB", "G").toString()).toBe("453.59237");
    expect(convert(1, "LB", "OZ").toString()).toBe("16");
    expect(roundQty(convert(1, "OZ", "G")).toString()).toBe("28.3495");
  });

  it("converts within volume", () => {
    expect(convert(2.5, "L", "ML").toString()).toBe("2500");
    expect(convert(250, "ML", "L").toString()).toBe("0.25");
  });

  it("returns the same amount for the same unit", () => {
    expect(convert("12.3456", "G", "G").toString()).toBe("12.3456");
  });

  it("survives a round trip without drift", () => {
    const there = convert("3.5", "G", "OZ");
    expect(roundQty(convert(there, "OZ", "G")).toString()).toBe("3.5");
  });

  it("refuses to convert between kinds of measure", () => {
    expect(canConvert("G", "ML")).toBe(false);
    expect(canConvert("EACH", "G")).toBe(false);
    expect(() => convert(1, "G", "EACH")).toThrow(/different kinds of measure/);
  });

  it("rounds to four places, half up", () => {
    expect(roundQty("1.00005").toString()).toBe("1.0001");
    expect(roundQty("1.00004").toString()).toBe("1");
  });

  it("formats with a unit label", () => {
    expect(formatQty("3.5000", "G")).toBe("3.5 g");
    expect(formatQty(12, "EACH")).toBe("12 ea");
  });
});
