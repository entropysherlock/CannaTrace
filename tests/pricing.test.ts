import { describe, expect, it } from "vitest";
import { FEATURES, FOUNDING, PRICES, SHOW_FOUNDING_OFFER, priceSentence } from "../src/lib/pricing";

describe("pricing", () => {
  it("is $299 a month for 1 facility and $499 for 2, with founders $100 off for life", () => {
    expect(PRICES.map((p) => [p.facilities, p.price, p.founderPrice])).toEqual([
      [1, 299, 199],
      [2, 499, 399],
    ]);
    for (const p of PRICES) expect(p.price - p.founderPrice).toBe(100);
  });
  it("includes every feature in the one plan", () => {
    for (const f of ["Manufacturing", "Wholesale", "Register", "Tally"]) expect(FEATURES.join(" ")).toContain(f);
  });
  it("keeps the founding offer to 5 businesses with 60 free days", () => {
    expect(FOUNDING).toMatchObject({ spots: 5, freeDays: 60 });
  });
  it("states the same prices everywhere they're written out", () => {
    expect(priceSentence()).toBe(
      "$299 a month for 1 facility, or $499 a month for 2 facilities, with every feature and unlimited team members.",
    );
  });
  it("keeps the founding offer off the public pages for now", () => {
    expect(SHOW_FOUNDING_OFFER).toBe(false);
  });
});
