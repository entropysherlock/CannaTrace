import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { fieldNameValues, fieldsUsed, withField, withoutField } from "@/lib/labels/field-usage";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { checkRecord } from "@/lib/labels/validate";
import type { LabelDesign } from "@/lib/labels/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const text = (html: string) => html.replace(/<!-- -->/g, "");

const design: LabelDesign = {
  widthMm: 76,
  heightMm: 51,
  elements: [
    { id: "b", type: "barcode", x: 2, y: 30, w: 70, h: 10, value: "{{package.tag}}", format: "code128" },
    { id: "a", type: "text", x: 2, y: 2, w: 70, h: 6, text: "{{item.name}}", fontSize: 12 },
    { id: "c", type: "text", x: 2, y: 10, w: 70, h: 6, text: "Lot {{package.lot}} · {{item.strain}}", fontSize: 9 },
    { id: "d", type: "text", x: 2, y: 20, w: 70, h: 5, text: "Typed words", fontSize: 8 },
  ],
};

describe("field usage", () => {
  it("lists each field once, top to bottom, with the pieces that use it", () => {
    expect(fieldsUsed(design).map((f) => f.key)).toEqual(["item.name", "package.lot", "item.strain", "package.tag"]);
    expect(fieldsUsed(design)[1]).toMatchObject({ label: "Lot number", elementIds: ["c"] });
  });
  it("adds and removes a field from a piece's words", () => {
    expect(withField("Lot", "package.lot")).toBe("Lot {{package.lot}}");
    expect(withField("", "package.lot")).toBe("{{package.lot}}");
    expect(withoutField("Lot {{package.lot}} · {{item.strain}}", "package.lot")).toBe("Lot · {{item.strain}}");
    expect(withoutField("{{item.name}}", "item.name")).toBe("");
  });
  it("shows fields by name so the changing parts are obvious", () => {
    const svg = renderLabelSvg(design, fieldNameValues("PACKAGE"));
    expect(svg).toContain("[Product name]");
    expect(svg).toContain("Typed words");
  });
  it("flags a field that is empty on the chosen record", () => {
    const issues = checkRecord(design, "PACKAGE", { ref: "1A4", sourceId: "x", values: { "item.name": "Cherry AK47", "package.tag": "1A4060300003B0100000007", "package.lot": null, "item.strain": "Cherry AK47" } });
    expect(issues.some((i) => i.code === "MISSING" && i.message.includes("Lot number"))).toBe(true);
  });
});

describe("field panel", () => {
  it("renders the fields, what is already on the label, and an empty-field warning for the chosen record", async () => {
    const { FieldPanel } = await import("@/components/labels/field-panel");
    const html = text(renderToString(
      createElement(FieldPanel, { kind: "PACKAGE", design, usingRecord: true, onPick: () => {}, values: { "item.name": "Cherry AK47", "package.lot": null, "item.strain": "Cherry AK47", "package.tag": "1A4" } }),
    ));
    expect(html).toContain("Fields from your records");
    expect(html).toContain("On this label (4)");
    expect(html).toContain("Cherry AK47");
    expect(html).toContain("empty on this record");
    expect(html).toContain("Lot number");
    expect(html).toContain("1 field is empty for this record");
  });
  it("says so when nothing on the label comes from a record", async () => {
    const { FieldPanel } = await import("@/components/labels/field-panel");
    const html = text(renderToString(createElement(FieldPanel, { kind: "PACKAGE", design: { ...design, elements: [design.elements[3]] }, usingRecord: false, onPick: () => {}, values: {} })));
    expect(html).toContain("every label prints the same");
  });
});
