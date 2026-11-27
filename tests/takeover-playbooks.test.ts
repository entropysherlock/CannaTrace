import { describe, expect, it } from "vitest";
import { PLAYBOOKS, pickOptions, playbooksFor } from "@/lib/takeover-playbooks";

describe("playbooksFor", () => {
  it("finds the right route for common jobs", () => {
    expect(playbooksFor("I need to produce 500 Blue Mesa 3.5 g jars")).toContain("/manufacturing/recipes");
    expect(playbooksFor("start a batch of strain X with 5 plants in Veg Room A")).toContain("/cultivation");
    expect(playbooksFor("Find package PKG-000165")).toContain("/inventory");
    expect(playbooksFor("receive 50 jars")).toContain("/inventory/receive");
    expect(playbooksFor("Harvest the newest flowering batch: record 500 g wet weight")).toContain("Grow guide");
    expect(playbooksFor("Record the dry weight for the harvest")).toContain("Dry weight");
  });
  it("gives nothing for unrelated goals and caps the length", () => {
    expect(playbooksFor("say hello")).toBe("");
    expect(playbooksFor("make jars and plan materials for the order and find the package in inventory", 2).split("•").length).toBe(3);
  });
  it("every playbook has steps, a title and a unique id", () => {
    expect(new Set(PLAYBOOKS.map((p) => p.id)).size).toBe(PLAYBOOKS.length);
    for (const p of PLAYBOOKS) {
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("pickOptions", () => {
  const items = Array.from({ length: 700 }, (_, n) => `Item ${n}`);
  items[650] = "Empty 3.5 g Jar with Lid (ea)";
  it("keeps short lists whole and removes repeats", () => {
    expect(pickOptions(["a", "a", "b"], "x", 80)).toEqual(["a", "b"]);
  });
  it("surfaces options that match the goal from a long list", () => {
    const shown = pickOptions(items, "receive 100 empty jar with lid", 80);
    expect(shown.length).toBe(80);
    expect(shown[0]).toBe("Empty 3.5 g Jar with Lid (ea)");
  });
});

describe("two-part jobs", () => {
  it("receive-then-make shows both routes without the plain lookup", () => {
    const text = playbooksFor("First receive 500 Empty 3.5 g Jar with Lid into inventory. Then make 500 Blue Mesa 3.5 g jars (5 batches)");
    expect(text).toContain("/inventory/receive");
    expect(text).toContain("/manufacturing/recipes");
    expect(text).not.toContain("Find a package");
  });
});
