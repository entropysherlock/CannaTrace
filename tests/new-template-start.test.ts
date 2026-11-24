import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { catalog } from "@/lib/labels/catalog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

describe("new template screen", () => {
  it("renders the upload start and the gallery start without crashing", async () => {
    const { NewTemplateStart } = await import("@/components/labels/new-template-start");
    const starters = catalog("NM");
    const upload = renderToString(createElement(NewTemplateStart, { starters, mine: [], aiReady: true, aiReason: null }));
    expect(upload).toContain("Upload a label you already use");
    expect(upload).toContain("Read this label");
    const noAi = renderToString(createElement(NewTemplateStart, { starters, mine: [], aiReady: false, aiReason: "NOT_CONNECTED" }));
    
    expect(noAi).toContain("Use this template");
    expect(noAi).toContain("NM product label 3×4 (edible)");
  });
});
