import { describe, expect, it } from "vitest";
import { darknessTestZpl, DARKNESS_STEPS } from "@/lib/labels/darkness-test";

describe("darkness test label", () => {
  const zpl = darknessTestZpl({ dpi: 203, widthMm: 101.6, heightMm: 50.8 });
  it("has one label per step, then a reset", () => {
    expect(zpl.match(/\^XA/g)).toHaveLength(DARKNESS_STEPS.length + 1);
    for (const s of DARKNESS_STEPS) expect(zpl).toContain(`^MD${s}`);
    expect(zpl.trim().endsWith("^XA^MD0^XZ")).toBe(true);
  });
  it("sizes the label in dots for the printer's resolution", () => {
    expect(zpl).toContain("^PW812^LL406");
    expect(darknessTestZpl({ dpi: 300, widthMm: 101.6, heightMm: 50.8 })).toContain("^PW1200^LL600");
  });
  it("includes a barcode and a solid block", () => {
    expect(zpl).toContain("^BCN");
    expect(zpl).toContain("^GB");
  });
});
