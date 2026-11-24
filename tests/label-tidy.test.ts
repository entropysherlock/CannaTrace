import { describe, expect, it } from "vitest";
import { designFromReading } from "@/lib/labels/import-design";
import { sampleValues } from "@/lib/labels/fields";
import { planCrop } from "@/lib/labels/straighten";
import { tidyDesign } from "@/lib/labels/tidy";
import type { LabelDesign, LabelElement } from "@/lib/labels/types";
import { checkDesign, checkRecord } from "@/lib/labels/validate";

const overlaps = (a: LabelElement, b: LabelElement) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

// A jumbled reading like a tilted photo of a bag label: crowded, overlapping, near-identical font sizes.
const jumbled = {
  label_kind: "PRODUCT",
  width_mm: 50.8,
  height_mm: 76.2,
  elements: [
    { type: "text", x: 0.03, y: 0.02, w: 0.9, h: 0.05, text: "{{item.name}}", printed_text: "Sanchitos (3 Pack)", font_size_pt: 8 },
    { type: "qr", x: 0.35, y: 0.1, w: 0.3, h: 0.15, value: "{{package.tag}}" },
    { type: "text", x: 0.03, y: 0.27, w: 0.94, h: 0.1, text: "Keep out of reach of children. For use only by adults 21 and older. Cannabinoid edibles can take up to two hours or more to take effect.", font_size_pt: 6.2 },
    { type: "text", x: 0.2, y: 0.36, w: 0.5, h: 0.04, text: "Manufactured By:", font_size_pt: 6.4 },
    { type: "text", x: 0.2, y: 0.39, w: 0.6, h: 0.04, text: "{{facility.name}}", font_size_pt: 6 },
    { type: "text", x: 0.2, y: 0.4, w: 0.6, h: 0.04, text: "{{facility.license}}", font_size_pt: 6.3 },
    { type: "text", x: 0.03, y: 0.5, w: 0.3, h: 0.04, text: "Total THC %", font_size_pt: 6 },
    { type: "text", x: 0.4, y: 0.5, w: 0.2, h: 0.04, text: "{{lab.thc}}", font_size_pt: 6 },
    { type: "text", x: 0.03, y: 0.54, w: 0.3, h: 0.04, text: "Total CBD %", font_size_pt: 6 },
    { type: "text", x: 0.4, y: 0.54, w: 0.2, h: 0.04, text: "{{lab.cbd}}", font_size_pt: 6 },
    { type: "barcode", x: 0.1, y: 0.62, w: 0.1, h: 0.05, value: "{{package.tag}}" },
    { type: "image", x: 0.6, y: 0.6, w: 0.3, h: 0.15, image_role: "STATE_LOGO" },
  ],
};

describe("tidying a rebuilt label", () => {
  const r = designFromReading(jumbled);
  const els = r.design.elements;
  it("leaves nothing overlapping and everything on the label", () => {
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) expect(overlaps(els[i], els[j]), `${els[i].text ?? els[i].type} / ${els[j].text ?? els[j].type}`).toBe(false);
    expect(checkDesign(r.design, "PRODUCT").filter((i) => i.severity === "block")).toEqual([]);
  });
  it("keeps what sat side by side on one row, in order", () => {
    const thc = els.find((e) => e.text === "Total THC %")!;
    const value = els.find((e) => e.text === "{{lab.thc}}")!;
    expect(Math.abs(thc.y - value.y)).toBeLessThan(0.5);
    expect(value.x).toBeGreaterThan(thc.x);
  });
  it("keeps reading order top to bottom", () => {
    const ys = els.filter((e) => e.type === "text").map((e) => e.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(els[0].text).toBe("{{item.name}}");
  });
  it("makes the product name bold and the barcode printable, with nothing cut off", () => {
    expect(els.find((e) => e.text === "{{item.name}}")?.bold).toBe(true);
    const issues = checkRecord(r.design, "PRODUCT", { ref: "X", sourceId: "x", values: { ...sampleValues("PRODUCT"), "_lab.status": "PASS", "_package.status": "ACTIVE" } });
    expect(issues.filter((i) => ["BARCODE_DENSE", "OVERFLOW", "OFF_LABEL"].includes(i.code))).toEqual([]);
  });
  it("uses a few font sizes, not a dozen near-misses", () => {
    expect(new Set(els.filter((e) => e.type === "text").map((e) => e.fontSize)).size).toBeLessThanOrEqual(3);
  });
  it("grows the label when the content needs more room, and never past the limit", () => {
    const big: LabelDesign = { widthMm: 40, heightMm: 20, elements: Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, type: "text" as const, x: 1, y: i, w: 38, h: 1.5, text: "Some fairly long printed words that wrap", fontSize: 7 })) };
    const t = tidyDesign(big, "PACKAGE").design;
    expect(t.heightMm).toBeGreaterThan(20);
    expect(t.heightMm).toBeLessThanOrEqual(300);
  });
});

describe("straightening a photo", () => {
  it("leaves an upright label alone and crops to it", () => {
    const p = planCrop([{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.6 }, { x: 0.2, y: 0.6 }], 1000, 2000)!;
    expect(p.angle).toBe(0);
    expect(p.crop.width).toBeGreaterThan(560);
    expect(p.crop.width).toBeLessThan(680);
  });
  it("turns a sideways label upright", () => {
    // A label lying on its side: its top edge runs straight down the photo.
    const p = planCrop([{ x: 0.7, y: 0.1 }, { x: 0.7, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.3, y: 0.1 }], 1000, 2000)!;
    expect(Math.round(p.angle)).toBe(-90);
    expect(p.crop.width).toBeGreaterThan(p.crop.height * 0.5);
  });
  it("gives up on nonsense", () => {
    expect(planCrop([], 100, 100)).toBeNull();
    expect(planCrop([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], 100, 100)).toBeNull();
  });
});
