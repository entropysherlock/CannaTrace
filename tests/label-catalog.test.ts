import { describe, expect, it } from "vitest";
import { catalog, recommend, USES } from "@/lib/labels/catalog";
import { designFromReading, snapToStock } from "@/lib/labels/import-design";
import { checkDesign, checkRecord } from "@/lib/labels/validate";

describe("catalog", () => {
  const all = catalog("NM");
  it("gives every starter at least one use, and every use at least one starter", () => {
    for (const t of all) expect(t.uses.length, t.name).toBeGreaterThan(0);
    for (const u of USES) expect(all.some((t) => t.uses.includes(u.id)), u.id).toBe(true);
  });
  it("recommends the template that matches the use and the roll", () => {
    const [best] = recommend(all, { use: "package", size: '2" × 1"' });
    expect(best.entry.name).toBe("Package label 2×1 (quick ID)");
    expect(best.reasons.join(" ")).toContain("Exactly your");
    const flower = recommend(all, { use: "flower", size: "" });
    expect(flower[0].entry.kind).toBe("PRODUCT");
  });
  it("marks templates bigger than the roll as a poor fit", () => {
    const picks = recommend(all, { use: "shipping", size: '2" × 1"' });
    expect(picks[0].reasons.join(" ")).toContain("Bigger than");
  });
});

describe("rebuilding a label from a reading", () => {
  it("snaps near-standard sizes and keeps odd ones", () => {
    expect(snapToStock(102, 51)).toEqual({ widthMm: 101.6, heightMm: 50.8 });
    expect(snapToStock(88, 40)).toEqual({ widthMm: 88, heightMm: 40 });
  });
  it("turns fractions into millimetres and keeps only fields the label type has", () => {
    const r = designFromReading({
      label_kind: "PACKAGE",
      width_mm: 101.6,
      height_mm: 50.8,
      elements: [
        { type: "text", x: 0.1, y: 0.1, w: 0.5, h: 0.2, text: "Lot {{package.lot}}", printed_text: "Lot A1", font_size_pt: 9 },
        { type: "text", x: 0.1, y: 0.4, w: 0.5, h: 0.2, text: "{{plant.tag}}", printed_text: "PL-1", font_size_pt: 9 },
        { type: "barcode", x: 0, y: 0.6, w: 1, h: 0.3, value: "12345" },
      ],
    });
    expect(r.design.elements[0]).toMatchObject({ text: "Lot {{package.lot}}" });
    // plant.tag isn't a package field, so the printed words are kept
    expect(r.design.elements[1].text).toBe("PL-1");
    expect(r.unmatched).toContain("PL-1");
    // a barcode with data that isn't a field scans to the package tag instead
    expect(r.design.elements[2].value).toBe("{{package.tag}}");
    expect(checkDesign(r.design, "PACKAGE").filter((i) => i.severity === "block")).toEqual([]);
  });
  it("clamps wild positions onto the label and survives junk", () => {
    const r = designFromReading({ width_mm: 50, height_mm: 25, elements: [{ type: "text", x: 5, y: -2, w: 9, h: 9, text: "Hi", font_size_pt: 500 }, { type: "wat" }, {}] });
    expect(checkDesign(r.design, "PACKAGE").filter((i) => i.severity === "block")).toEqual([]);
    expect(r.design.elements).toHaveLength(1);
  });
  it("uses the picture's shape when no size was printed", () => {
    const r = designFromReading({ elements: [] }, { aspect: 2 });
    expect(r.design.widthMm / r.design.heightMm).toBeCloseTo(2, 1);
    expect(r.notes.join(" ")).toContain("Nothing on the picture");
  });
  it("gives long text a box tall enough that nothing is cut off", () => {
    const text = "For use only by adults 21 and older. Keep out of reach of children. ".repeat(3);
    const r = designFromReading({ width_mm: 101.6, height_mm: 50.8, elements: [{ type: "text", x: 0, y: 0, w: 0.9, h: 0.1, text, printed_text: text, font_size_pt: 10 }] });
    const issues = checkRecord(r.design, "PACKAGE", { ref: "X", sourceId: "x", values: {} });
    expect(issues.filter((i) => i.code === "OVERFLOW")).toEqual([]);
    expect(r.design.elements[0].h).toBeGreaterThan(10);
  });
});

import { valuesFromPrinted } from "@/lib/labels/import-design";
import { describe as d2, expect as e2, it as i2 } from "vitest";

d2("valuesFromPrinted", () => {
  i2("reads each field's value out of the printed words", () => {
    e2(valuesFromPrinted("{{item.name}}", "Cherry AK47 3.5g")).toEqual({ "item.name": "Cherry AK47 3.5g" });
    e2(valuesFromPrinted("Lot {{package.lot}} · Harvest {{package.harvest}}", "Lot BD-1 · Harvest 10/02/26")).toEqual({ "package.lot": "BD-1", "package.harvest": "10/02/26" });
    e2(valuesFromPrinted("Lot {{package.lot}}", "Something else")).toEqual({});
    e2(valuesFromPrinted("No fields here", "No fields here")).toEqual({});
  });
});
