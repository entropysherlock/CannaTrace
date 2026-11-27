import { describe, expect, it } from "vitest";
import { checkAction, describeElements, isRiskyLabel, isSafePath, parseAction, type PageElement } from "@/lib/takeover-math";

const els: PageElement[] = [
  { i: 0, tag: "button", label: "Play" },
  { i: 1, tag: "button", label: "Remove" },
  { i: 2, tag: "input", type: "password", label: "Password" },
  { i: 3, tag: "input", type: "text", label: "Batches" },
  { i: 4, tag: "select", label: "Recipe", options: ["A", "B"] },
  { i: 5, tag: "button", label: "Save", disabled: true },
  { i: 6, tag: "a", label: "Settings", href: "/settings" },
  { i: 7, tag: "a", label: "Sign out", href: "/signout" },
  { i: 8, tag: "input", type: "text", label: "Verification code" },
];
describe("checkAction", () => {
  it("lets ordinary clicks, typing and selects through", () => {
    expect(checkAction({ type: "click", i: 0 }, els)).toEqual({ action: { type: "click", i: 0 } });
    expect("action" in checkAction({ type: "type", i: 3, text: "2" }, els)).toBe(true);
    expect("action" in checkAction({ type: "select", i: 4, value: "A" }, els)).toBe(true);
  });
  it("hands risky buttons back to the person", () => {
    expect("stop" in checkAction({ type: "click", i: 1 }, els)).toBe(true);
    expect("stop" in checkAction({ type: "click", i: 7 }, els)).toBe(true);
  });
  it("never types passwords or codes", () => {
    expect("stop" in checkAction({ type: "type", i: 2, text: "x" }, els)).toBe(true);
    expect("stop" in checkAction({ type: "type", i: 8, text: "123456" }, els)).toBe(true);
  });
  it("refuses disabled, missing and wrong-kind targets", () => {
    expect("stop" in checkAction({ type: "click", i: 5 }, els)).toBe(true);
    expect("stop" in checkAction({ type: "click", i: 99 }, els)).toBe(true);
    expect("stop" in checkAction({ type: "type", i: 0, text: "x" }, els)).toBe(true);
    expect("stop" in checkAction({ type: "select", i: 3, value: "x" }, els)).toBe(true);
  });
  it("only navigates to safe in-app paths", () => {
    expect("action" in checkAction({ type: "navigate", path: "/manufacturing/recipes" }, els)).toBe(true);
    for (const bad of ["https://evil.com", "//evil.com", "/signout", "/api/x", "/account", "javascript:1"]) expect("stop" in checkAction({ type: "navigate", path: bad }, els)).toBe(true);
  });
});
describe("helpers", () => {
  it("flags risky wording", () => {
    for (const l of ["Delete", "Remove", "Disconnect", "Sign out", "Cancel this run", "Refund payment", "Pay now"]) expect(isRiskyLabel(l)).toBe(true);
    for (const l of ["Play", "Save", "Show the plan", "Complete run", "Add cost", "Cancel"]) expect(isRiskyLabel(l)).toBe(false);
    expect(isSafePath("/inventory")).toBe(true);
  });
  it("parses model output defensively", () => {
    expect(parseAction({ type: "click", i: "3" })).toEqual({ type: "click", i: 3 });
    expect(parseAction({ type: "type", i: 1, text: "5", submit: true })).toEqual({ type: "type", i: 1, text: "5", submit: true });
    expect(parseAction({ type: "click" })).toBeNull();
    expect(parseAction({ type: "hack" })).toBeNull();
    expect(parseAction("click")).toBeNull();
    expect(parseAction({ type: "done" })).toEqual({ type: "done", message: "Done." });
  });
  it("shows the agent long dropdowns in full", () => {
    const options = Array.from({ length: 40 }, (_, n) => (n === 35 ? "Veg Room A" : `Room ${n}`));
    expect(describeElements([{ i: 0, tag: "select", label: "Room", options }])).toContain("Veg Room A");
  });
  it("describes elements compactly", () => {
    expect(describeElements(els.slice(0, 2))).toBe('[0] button "Play"\n[1] button "Remove"');
  });
});
