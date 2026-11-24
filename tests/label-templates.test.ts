import { describe, expect, it } from "vitest";
import { starterTemplates } from "@/lib/labels/defaults";
import { sampleValues } from "@/lib/labels/fields";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { checkDesign, checkJurisdiction, checkRecord } from "@/lib/labels/validate";

describe("starter templates", () => {
  const all = starterTemplates("NM");
  it("has unique names and a good spread of kinds", () => {
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
    for (const kind of ["PLANT", "BATCH", "PACKAGE", "PRODUCT", "TRANSFER"] as const) expect(all.filter((t) => t.kind === kind).length).toBeGreaterThanOrEqual(2);
    expect(all.length).toBeGreaterThanOrEqual(20);
  });
  for (const t of all) {
    it(`${t.name}: fits on its label with no layout blocks`, () => {
      expect(checkDesign(t.design, t.kind).filter((i) => i.severity === "block")).toEqual([]);
    });
    it(`${t.name}: sample data prints without cut-off text`, () => {
      const values = { ...sampleValues(t.kind), "_package.status": "ACTIVE", "_lab.status": "PASS" };
      const issues = checkRecord(t.design, t.kind, { ref: "X", sourceId: "x", values });
      expect(issues.filter((i) => i.code === "OVERFLOW" || i.code === "OFF_LABEL" || i.code === "BARCODE_DENSE")).toEqual([]);
      expect(renderLabelSvg(t.design, values, { scale: 4 })).toContain("<svg");
    });
    if (t.jurisdiction === "NM") {
      it(`${t.name}: meets every New Mexico check except the official logo upload`, () => {
        const blocks = checkJurisdiction(t.design, "PRODUCT", "NM").issues.filter((i) => i.severity === "block");
        expect(blocks.map((i) => i.code)).toEqual(["RULE_nm-logo_FILE"]);
      });
    }
  }
});
