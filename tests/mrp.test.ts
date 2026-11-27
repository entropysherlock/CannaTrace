import { describe, expect, it } from "vitest";
import { planDemand } from "@/lib/mrp";
import type { ChainRecipe } from "@/lib/bom-tree";

const cones: ChainRecipe = { id: "r-cone", name: "Pre-roll cones", outputItemId: "cone", outputQuantity: 10, lines: [{ itemId: "flower", quantity: 5 }, { itemId: "paper", quantity: 10 }] };
const box: ChainRecipe = { id: "r-box", name: "Boxed pre-rolls", outputItemId: "box", outputQuantity: 1, lines: [{ itemId: "cone", quantity: 5 }, { itemId: "carton", quantity: 1 }] };
const jar: ChainRecipe = { id: "r-jar", name: "Jarred cones", outputItemId: "jar", outputQuantity: 1, lines: [{ itemId: "cone", quantity: 10 }, { itemId: "glass", quantity: 1 }] };
const raw = (p: ReturnType<typeof planDemand>) => Object.fromEntries(p.raw.map((r) => [r.itemId, r.needed.toNumber()]));

describe("planDemand", () => {
  it("shares one intermediate between two products and makes it once", () => {
    const plan = planDemand([cones, box, jar], [{ recipeId: "r-box", batches: 20 }, { recipeId: "r-jar", batches: 5 }]);
    // 100 cones for boxes + 50 for jars = 150 = 15 batches
    expect(plan.stages.filter((s) => s.name === "Pre-roll cones")).toHaveLength(1);
    expect(plan.stages[0].batches.toNumber()).toBe(15);
    expect(raw(plan)).toEqual({ flower: 75, paper: 150, carton: 20, glass: 5 });
  });
  it("nets stock and reports the shortfall", () => {
    const plan = planDemand([cones, box], [{ recipeId: "r-box", batches: 20 }], new Map([["cone", 60], ["flower", 10]]));
    expect(plan.stages[0].batches.toNumber()).toBe(4);
    expect(plan.raw.find((r) => r.itemId === "flower")?.short.toNumber()).toBe(10);
  });
  it("adds a recipe that is both wanted and needed", () => {
    const plan = planDemand([cones, box], [{ recipeId: "r-box", batches: 2 }, { recipeId: "r-cone", batches: 1 }]);
    expect(plan.stages[0].plannedOutput.toNumber()).toBe(20); // 10 for boxes + 10 asked
  });
  it("rejects empty or bad demand", () => {
    expect(() => planDemand([cones], [])).toThrow();
    expect(() => planDemand([cones], [{ recipeId: "r-cone", batches: 0 }])).toThrow();
    expect(() => planDemand([cones], [{ recipeId: "nope", batches: 1 }])).toThrow();
  });
});
