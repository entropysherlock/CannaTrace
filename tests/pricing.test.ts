import { describe, expect, it } from "vitest";
import { FEATURES, PRICE_PER_FACILITY, priceSentence } from "../src/lib/pricing";

describe("pricing", () => {
  it("is $299 a month per facility, one flat price", () => {
    expect(PRICE_PER_FACILITY).toBe(299);
  });

  it("says it in one sentence, with unlimited users and no deals", () => {
    expect(priceSentence()).toBe("$299 a month per facility, with every feature and unlimited users. No contract; pay month to month.");
    expect(priceSentence()).not.toMatch(/found|free|off|discount|trial/i);
  });

  it("includes unlimited users", () => {
    expect(FEATURES).toContain("Unlimited users");
  });
});
