import { describe, expect, it } from "vitest";
import { licenseKey, matchBusiness, pickCostPackage, tagKey, unitFromText } from "@/lib/scan/apply-math";

describe("unitFromText", () => {
  it("understands how documents write units", () => {
    expect(unitFromText("Grams")).toBe("G");
    expect(unitFromText("lbs")).toBe("LB");
    expect(unitFromText("ea")).toBe("EACH");
    expect(unitFromText("each.")).toBe("EACH");
    expect(unitFromText("furlong")).toBeNull();
    expect(unitFromText("")).toBeNull();
  });
});

describe("licenseKey and tagKey", () => {
  it("ignore case and punctuation", () => {
    expect(licenseKey("demo-ret 0002")).toBe("DEMORET0002");
    expect(tagKey(" pl-000 115 ")).toBe("PL-000115");
  });
});

describe("matchBusiness", () => {
  const rows = [
    { id: "a", name: "Turquoise Trail Dispensary", licenseNumber: "DEMO-RET-0417" },
    { id: "b", name: "Bosque Wellness", licenseNumber: "DEMO-RET-0533" },
  ];
  it("prefers the license number", () => {
    expect(matchBusiness("Something else", "demo ret 0533", rows)?.id).toBe("b");
  });
  it("falls back to a clear name match", () => {
    expect(matchBusiness("Turquoise Trail Dispensary LLC", "", rows)?.id).toBe("a");
  });
  it("gives nothing when it is not clear", () => {
    expect(matchBusiness("Wellness Trail", "", rows)).toBeNull();
    expect(matchBusiness("", "", rows)).toBeNull();
  });
});

describe("pickCostPackage", () => {
  const pkgs = [
    { id: "new", costPerUnit: "2", vendorId: null },
    { id: "mid", costPerUnit: null, vendorId: "v1" },
    { id: "old", costPerUnit: null, vendorId: null },
  ];
  it("prefers a package with no cost, then the vendor's", () => {
    expect(pickCostPackage(pkgs, "v1")?.id).toBe("mid");
    expect(pickCostPackage(pkgs, "")?.id).toBe("mid");
  });
  it("uses the newest when every package has a cost", () => {
    expect(pickCostPackage([{ id: "x", costPerUnit: "1", vendorId: null }], "")?.id).toBe("x");
    expect(pickCostPackage([], "")).toBeNull();
  });
});
