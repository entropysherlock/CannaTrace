import { describe, expect, it } from "vitest";
import { matchItem, matchVendor } from "@/lib/scan/manifest-math";

const items = [
  { id: "1", name: "Desert Haze 3.5g", sku: "DH-35" },
  { id: "2", name: "Desert Haze Pre-roll 1g", sku: "DH-PR1" },
  { id: "3", name: "Blue Mesa Pre-roll 1g", sku: "BM-PR1" },
];

describe("matching manifest lines to items", () => {
  it("finds the item when the words agree, and not the look-alike", () => {
    expect(matchItem("Desert Haze 3.5g flower", items)?.id).toBe("1");
    expect(matchItem("Blue Mesa pre-roll 1g", items)?.id).toBe("3");
  });
  it("uses a SKU printed on the line", () => {
    expect(matchItem("DH-PR1 pre-roll", items)?.id).toBe("2");
  });
  it("leaves it for the person when it isn't clear", () => {
    expect(matchItem("Mystery gummies", items)).toBeNull();
    expect(matchItem("", items)).toBeNull();
    expect(matchItem("Pre-roll 1g", items)).toBeNull(); // two items fit equally well
  });
  it("matches a sender to a vendor only when it is clear", () => {
    const vendors = [{ id: "a", name: "High Desert Wholesale LLC" }, { id: "b", name: "Mesa Packaging" }];
    expect(matchVendor("High Desert Wholesale", vendors)?.id).toBe("a");
    expect(matchVendor("Desert Supply", vendors)).toBeNull();
    expect(matchVendor("", vendors)).toBeNull();
  });
});
