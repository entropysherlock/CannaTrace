import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { starterTemplates } from "@/lib/labels/defaults";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

describe("template editor print button", () => {
  it("links a saved template to the print page with that template chosen", async () => {
    const { LabelDesigner } = await import("@/components/labels/designer");
    const t = starterTemplates("NM").find((x) => x.kind === "PACKAGE")!;
    const html = renderToString(createElement(LabelDesigner, { mode: "edit", templateId: "tpl-1", initial: { name: t.name, kind: t.kind, jurisdiction: t.jurisdiction ?? null, design: t.design, version: 1 } }));
    expect(html).toContain('href="/labels?kind=PACKAGE&amp;template=tpl-1"');
    expect(html).toContain("Print many labels (choose packages)");
  });
});

describe("print now panel", () => {
  it("is on a saved template's editor, with copies and a sample link", async () => {
    const { LabelDesigner } = await import("@/components/labels/designer");
    const t = starterTemplates("NM").find((x) => x.kind === "PACKAGE")!;
    const html = renderToString(createElement(LabelDesigner, { mode: "edit", templateId: "tpl-1", initial: { name: t.name, kind: t.kind, jurisdiction: t.jurisdiction ?? null, design: t.design, version: 1 } })).replace(/<!-- -->/g, "");
    expect(html).toContain('data-testid="print-now"');
    expect(html).toContain("Print this template");
    expect(html).toContain("Print a sample");
  });
  it("is also on the New template page, with the sample button that works before saving", async () => {
    const { LabelDesigner } = await import("@/components/labels/designer");
    const t = starterTemplates("NM")[0];
    const html = renderToString(createElement(LabelDesigner, { mode: "new", initial: { name: t.name, kind: t.kind, jurisdiction: t.jurisdiction ?? null, design: t.design, version: 0 } })).replace(/<!-- -->/g, "");
    expect(html).toContain('data-testid="print-now"');
    expect(html).toContain("Print a sample (works before saving)");
    expect(html).toContain("Create template");
    expect(html).not.toContain("Print many labels");
  });
});
