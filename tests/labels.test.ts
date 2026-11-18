import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { encode, code128Problem, placement } from "@/lib/labels/barcode";
import { starterTemplates } from "@/lib/labels/defaults";
import { parseDesign, DesignError } from "@/lib/labels/design";
import { fill, placeholders, sampleValues, fieldsFor } from "@/lib/labels/fields";
import { labelPackFor } from "@/lib/labels/jurisdictions";
import { renderLabelsPdf } from "@/lib/labels/render-pdf";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { wrapText, layoutText } from "@/lib/labels/text";
import type { LabelDesign, LabelRecord } from "@/lib/labels/types";
import { checkDesign, checkJurisdiction, checkRecord, validateLabels } from "@/lib/labels/validate";

const starter = (name: string) => starterTemplates("NM").find((t) => t.name.startsWith(name))!;

function pkgRecord(over: Record<string, string | null> = {}): LabelRecord {
  return {
    ref: "CT-000007",
    sourceId: "p1",
    values: {
      ...sampleValues("PACKAGE"),
      "package.tag": "CT-000007",
      "_package.status": "ACTIVE",
      "_package.quantity": "28",
      "_lab.status": "PASS",
      ...over,
    },
  };
}

describe("fields", () => {
  it("fills placeholders and reports missing and unknown ones", () => {
    const r = fill("{{package.tag}} / {{package.lot}} / {{nope.x}}", { "package.tag": "CT-1", "package.lot": null });
    expect(r.text).toBe("CT-1 /  / ");
    expect(r.missing).toEqual(["package.lot"]);
    expect(r.unknown).toEqual(["nope.x"]);
    expect(placeholders("a {{ item.name }} b")).toEqual(["item.name"]);
  });
  it("only offers fields that exist for the record type", () => {
    expect(fieldsFor("PLANT").some((f) => f.key === "lab.thc")).toBe(false);
    expect(fieldsFor("PRODUCT").some((f) => f.key === "lab.thc")).toBe(true);
  });
});

describe("text layout", () => {
  it("wraps long text and reports overflow", () => {
    const lines = wrapText("one two three four five six seven eight nine ten", 20, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(layoutText("x ".repeat(200), 20, 4, 10).overflow).toBe(true);
    expect(layoutText("short", 50, 10, 8).overflow).toBe(false);
  });
});

describe("barcodes", () => {
  it("encodes Code 128 and rejects characters it can't hold", () => {
    const sym = encode("code128", "CT-000007");
    expect(sym.kind).toBe("linear");
    if (sym.kind === "linear") expect(sym.modules).toBe(112);
    expect(code128Problem("héllo")).toMatch(/cannot hold/);
    expect(code128Problem("")).toMatch(/nothing/);
  });
  it("keeps QR codes square with a quiet zone", () => {
    const sym = encode("qrcode", "https://example.com/p/1");
    const p = placement(sym, { x: 0, y: 0, w: 30, h: 20 });
    expect(sym.kind).toBe("matrix");
    if (sym.kind === "matrix") expect(p.module * (sym.cols + 8)).toBeCloseTo(20, 5);
  });
});

describe("rendering", () => {
  it("draws an SVG at real size in millimetres with the data filled in", () => {
    const svg = renderLabelSvg(starter("Package").design, pkgRecord().values);
    expect(svg).toContain('width="101.6mm"');
    expect(svg).toContain('height="50.8mm"');
    expect(svg).toContain("CT-000007");
    expect(svg).toContain("<path");
  });
  it("makes one PDF page per label at the exact label size", async () => {
    const t = starter("Package");
    const bytes = await renderLabelsPdf(t.design, [pkgRecord(), pkgRecord({ "package.tag": "CT-000008" })], { copies: 2 });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo((101.6 * 72) / 25.4, 2);
    expect(height).toBeCloseTo((50.8 * 72) / 25.4, 2);
  });
});

describe("design parsing", () => {
  it("cleans untrusted designs", () => {
    const d = parseDesign({ widthMm: 50, heightMm: 25, elements: [{ type: "text", x: 1, y: 1, w: 10, h: 5, text: "hi", fontSize: 999, evil: true }] });
    expect(d.elements[0].fontSize).toBe(72);
    expect((d.elements[0] as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(() => parseDesign({ widthMm: 1, heightMm: 1, elements: [] })).toThrow(DesignError);
    expect(() => parseDesign({ widthMm: 50, heightMm: 50, elements: [{ type: "script" }] })).toThrow(DesignError);
  });
});

describe("validation", () => {
  it("passes a starter package label with good data", () => {
    const t = starter("Package");
    const r = validateLabels(t.design, "PACKAGE", null, [pkgRecord()]);
    expect(r.blocked).toBe(false);
  });
  it("blocks elements off the label and unknown fields", () => {
    const d: LabelDesign = { widthMm: 50, heightMm: 25, elements: [{ id: "a", type: "text", x: 45, y: 0, w: 20, h: 5, text: "{{item.secret}}" }] };
    const codes = checkDesign(d, "PACKAGE").map((i) => i.code);
    expect(codes).toContain("OFF_LABEL");
    expect(codes).toContain("UNKNOWN_FIELD");
  });
  it("tells missing data apart from inconsistent data", () => {
    const t = starter("Package");
    const issues = checkRecord(t.design, "PACKAGE", pkgRecord({ "package.tag": null, "package.lot": null, "_package.status": "DESTROYED" }));
    const missingTag = issues.find((i) => i.code === "MISSING" && i.message.includes("Package ID"));
    expect(missingTag?.severity).toBe("block");
    expect(missingTag?.category).toBe("MISSING_DATA");
    expect(issues.find((i) => i.code === "PACKAGE_GONE")?.category).toBe("INCONSISTENT_DATA");
  });
  it("never lets a product label print without a passed lab test", () => {
    const t = starter("NM product");
    const issues = checkRecord(t.design, "PRODUCT", pkgRecord({ "_lab.status": "PENDING", "lab.thc": null }));
    expect(issues.some((i) => i.code === "LAB_MISSING" && i.severity === "block")).toBe(true);
    expect(issues.some((i) => i.code === "MISSING" && i.message.includes("never prints potency"))).toBe(true);
  });
  it("blocks a barcode too dense to print and explains how wide it must be", () => {
    const d: LabelDesign = { widthMm: 50, heightMm: 25, elements: [{ id: "b", type: "barcode", x: 0, y: 0, w: 12, h: 10, value: "{{package.tag}}", format: "code128" }] };
    const issues = checkRecord(d, "PACKAGE", pkgRecord());
    const dense = issues.find((i) => i.code === "BARCODE_DENSE");
    expect(dense?.severity).toBe("block");
    expect(dense?.fix).toMatch(/Widen the barcode to at least \d+ mm/);
  });
});

describe("state label rules", () => {
  it("has verified New Mexico rules with citations and nothing for other states", () => {
    const nm = labelPackFor("NM")!;
    expect(nm.rules.every((r) => r.citation.includes("16.8.3.9"))).toBe(true);
    expect(nm.url).toMatch(/^https:\/\/www\.srca\.nm\.gov\//);
    expect(labelPackFor("CA")).toBeNull();
  });
  it("says plainly when a state has no verified label rules", () => {
    const r = checkJurisdiction(starter("Package").design, "PRODUCT", "CA");
    expect(r.issues[0].code).toBe("STATE_UNSUPPORTED");
    expect(r.issues[0].message).toMatch(/no verified label rules for CA/);
    expect(r.checked).toBe(0);
  });
  it("does not apply New Mexico product rules to internal package labels", () => {
    const r = checkJurisdiction(starter("Package").design, "PACKAGE", "NM");
    expect(r.issues.map((i) => i.code)).toEqual(["KIND_UNSUPPORTED"]);
  });
  it("blocks the NM product label until the official logo is uploaded, and passes the rest", () => {
    const t = starter("NM product");
    const r = checkJurisdiction(t.design, "PRODUCT", "NM");
    const blocks = r.issues.filter((i) => i.severity === "block");
    expect(blocks.map((i) => i.code)).toEqual(["RULE_nm-logo_FILE"]);
    expect(r.manual).toBeGreaterThan(0);
  });
  it("catches a reworded warning and a missing bold product name", () => {
    const t = starter("NM product");
    const design: LabelDesign = {
      ...t.design,
      elements: t.design.elements.map((e) =>
        e.text?.startsWith("For use only") ? { ...e, text: "Adults only. Keep away from kids." } : e.text === "{{item.name}}" ? { ...e, bold: false } : e,
      ),
    };
    const codes = checkJurisdiction(design, "PRODUCT", "NM").issues.filter((i) => i.severity === "block").map((i) => i.code);
    expect(codes).toContain("RULE_nm-warning");
    expect(codes).toContain("RULE_nm-identity_BOLD");
  });
});
