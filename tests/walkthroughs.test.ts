import { describe, expect, it } from "vitest";
import { stepAfterArriving, walkthroughById, WALKTHROUGHS } from "../src/lib/walkthroughs";

describe("SmartWorkflows walkthroughs", () => {
  it("have unique ids and steps with something to say", () => {
    expect(new Set(WALKTHROUGHS.map((w) => w.id)).size).toBe(WALKTHROUGHS.length);
    for (const w of WALKTHROUGHS) {
      expect(w.steps.length).toBeGreaterThan(1);
      for (const s of w.steps) expect(s.title.length && s.body.length).toBeTruthy();
    }
  });
  it("only send people to addresses their own step lives on", () => {
    for (const w of WALKTHROUGHS) for (const s of w.steps) if (s.go) expect(s.path.test(s.go), `${w.id}: ${s.title}`).toBe(true);
  });
  it("only make steps optional when they highlight something whose absence means it's done", () => {
    for (const w of WALKTHROUGHS) for (const s of w.steps) if (s.optional) expect(s.target?.length, `${w.id}: ${s.title}`).toBeTruthy();
  });
  it("start somewhere the employee can be taken", () => {
    for (const w of WALKTHROUGHS) expect(w.steps[0].go, w.id).toBeTruthy();
  });
  it("moves on when a save lands on the next step's page, and not otherwise", () => {
    const w = walkthroughById("fill-an-order")!;
    expect(stepAfterArriving(w, 0, "/distribution/orders/abc")).toBe(1); // Start order redirected to the order
    expect(stepAfterArriving(w, 0, "/distribution")).toBe(0);
    expect(stepAfterArriving(w, 0, "/inventory")).toBe(0); // wandered off: stays put
    const r = walkthroughById("receive-delivery")!;
    expect(r.steps[4].path.test("/inventory/receive")).toBe(false); // the receive form isn't a package page
  });
});
