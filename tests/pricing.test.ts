import { describe, expect, it } from "vitest";
import { FOUNDING, PLANS } from "../src/lib/pricing";

describe("pricing", () => {
  it("offers Starter at $199 and Pro at $399, with founding prices about half", () => {
    expect(PLANS.map((p) => [p.name, p.price, p.founderPrice])).toEqual([
      ["Starter", 199, 99],
      ["Pro", 399, 199],
    ]);
    for (const p of PLANS) expect(Math.abs(p.founderPrice / p.price - 0.5)).toBeLessThan(0.01);
  });
  it("keeps the founding offer to 5 businesses with 60 free days", () => {
    expect(FOUNDING).toMatchObject({ spots: 5, freeDays: 60 });
  });
});
