import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { findLoop, planChain, type ChainRecipe } from "@/lib/bom-tree";

// flower -> cones (10 cones from 5 g) -> boxed pre-rolls (1 box = 5 cones)
const cones: ChainRecipe = { id: "r-cone", name: "Pre-roll cones", outputItemId: "cone", outputQuantity: 10, lines: [{ itemId: "flower", quantity: 5 }, { itemId: "paper", quantity: 10 }] };
const box: ChainRecipe = { id: "r-box", name: "Boxed pre-rolls", outputItemId: "box", outputQuantity: 1, lines: [{ itemId: "cone", quantity: 5 }, { itemId: "carton", quantity: 1 }] };

describe("planChain", () => {
  it("makes intermediates first and adds up the raw materials", () => {
    const plan = planChain([box, cones], "r-box", 20);
    expect(plan.stages.map((s) => s.name)).toEqual(["Pre-roll cones", "Boxed pre-rolls"]);
    // 20 boxes need 100 cones = 10 batches of cones = 50 g flower, 100 paper; plus 20 cartons
    expect(plan.stages[0].batches.toNumber()).toBe(10);
    const raw = Object.fromEntries(plan.raw.map((r) => [r.itemId, r.needed.toNumber()]));
    expect(raw).toEqual({ flower: 50, paper: 100, carton: 20 });
    expect(plan.stages[0].inputs.every((i) => !i.fromStage)).toBe(true);
    expect(plan.stages[1].inputs.find((i) => i.itemId === "cone")?.fromStage).toBe(true);
  });

  it("uses intermediates already in stock before making more", () => {
    const plan = planChain([box, cones], "r-box", 20, new Map([["cone", 60]]));
    // 100 cones wanted, 60 in stock, 40 to make = 4 batches
    expect(plan.stages[0].batches.toNumber()).toBe(4);
    expect(plan.usedFromStock).toEqual([{ itemId: "cone", quantity: new Decimal(60) }]);
  });

  it("skips a stage entirely when stock covers it", () => {
    const plan = planChain([box, cones], "r-box", 2, new Map([["cone", 50]]));
    expect(plan.stages.map((s) => s.name)).toEqual(["Boxed pre-rolls"]);
  });

  it("reports raw shortfalls against stock", () => {
    const plan = planChain([box, cones], "r-box", 20, new Map([["flower", 30], ["paper", 500], ["carton", 20]]));
    const flower = plan.raw.find((r) => r.itemId === "flower")!;
    expect(flower.short.toNumber()).toBe(20);
    expect(plan.raw.find((r) => r.itemId === "paper")!.short.toNumber()).toBe(0);
  });

  it("sums an intermediate used by two stages", () => {
    const gift: ChainRecipe = { id: "r-gift", name: "Gift pack", outputItemId: "gift", outputQuantity: 1, lines: [{ itemId: "box", quantity: 2 }, { itemId: "cone", quantity: 3 }] };
    const plan = planChain([gift, box, cones], "r-gift", 1);
    // 2 boxes need 10 cones, plus 3 loose = 13 cones => 1.3 batches
    expect(plan.stages.map((s) => s.name)).toEqual(["Pre-roll cones", "Boxed pre-rolls", "Gift pack"]);
    expect(plan.stages[0].batches.toNumber()).toBe(1.3);
  });

  it("refuses a circle of recipes and names it", () => {
    const a: ChainRecipe = { id: "a", name: "A", outputItemId: "x", outputQuantity: 1, lines: [{ itemId: "y", quantity: 1 }] };
    const b: ChainRecipe = { id: "b", name: "B", outputItemId: "y", outputQuantity: 1, lines: [{ itemId: "x", quantity: 1 }] };
    expect(findLoop([a, b])).toEqual(["A", "B", "A"]);
    expect(() => planChain([a, b], "a", 1)).toThrow(/circle/);
    expect(findLoop([cones, box])).toBeNull();
  });

  it("a recipe that only uses raw materials is a single stage", () => {
    const plan = planChain([cones], "r-cone", 2);
    expect(plan.stages).toHaveLength(1);
    expect(plan.raw.find((r) => r.itemId === "flower")!.needed.toNumber()).toBe(10);
  });
});
