import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_GUIDE } from "@/lib/assistant/app-guide";

describe("Tally's app guide", () => {
  it("names every sidebar section and tab that exists", () => {
    const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
    // Every [href, "Tab label", ...] and entry(key, "Section", ...) in the sidebar
    const labels = [...layout.matchAll(/\["\/[^"]*", "([^"]+)"/g), ...layout.matchAll(/entry\(\s*"[^"]+",\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(20);
    const missing = [...new Set(labels)].filter((l) => !APP_GUIDE.includes(l) && l !== "Support Console");
    expect(missing).toEqual([]);
  });
  it("names the buttons people ask about most", () => {
    for (const b of ["Add a room", "Start a batch", "Tag plants", "Record dry weight", "Finish harvest", "Add lab result", "Label details", "Start an order", "Invite someone", "Check and preview"]) {
      expect(APP_GUIDE).toContain(b);
    }
  });
});
