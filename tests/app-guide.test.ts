import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  it("explains the newer screens and rules, using names that are really on screen", () => {
    // Every source file's text, to check each name the guide cites still exists in the app.
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));
    const source = files("src").filter((f) => !f.endsWith("app-guide.ts")).map((f) => readFileSync(f, "utf8")).join("\n");
    const onScreen = [
      "Reopen harvest",
      "Take over",
      "Show what to fix",
      "I fixed it, check again",
      "Fix it in the template",
      "Receive it against the manifest",
      "Apply to ticked packages",
      "With the ticked packages",
      "Same test, rest of lot",
      "How many packages",
      "Pick everything, oldest first",
      "Needs attention today",
      "Left to account for",
      "Estimated cost this month",
      "Match against the state system",
      "Upload and compare",
      "What changed",
      "Kind of record",
      "Forgot your password?",
      "Online menu and pickups",
      "To review",
      "Customer is here: check ID and start the sale",
      "Mark ready",
      "Approval number",
      "Card payments this shift",
    ];
    for (const name of onScreen) {
      expect(APP_GUIDE, `guide should mention "${name}"`).toContain(name);
      expect(source, `"${name}" should still be in the app`).toContain(name);
    }
    // Rules Tally must not get wrong
    for (const rule of ["does not release it", "can't be finished until its dry weight", "can't be voided", "\"Keep\"", "only appears at facilities that sell"]) {
      expect(APP_GUIDE).toContain(rule);
    }
  });

  it("names the buttons people ask about most", () => {
    for (const b of ["Add a room", "Start a batch", "Tag plants", "Record dry weight", "Finish harvest", "Add lab result", "Label details", "Start an order", "Invite someone", "Check and preview"]) {
      expect(APP_GUIDE).toContain(b);
    }
  });
});
