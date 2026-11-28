import { describe, expect, it } from "vitest";
import {
  boostPercent,
  brandOwes,
  classifySegment,
  cleanBoost,
  cleanTags,
  cleanTier,
  codeFromBytes,
  combinedPercent,
  isQuietTime,
  nextTier,
  normalizeEmail,
  pointsAtSpeed,
  renderTemplate,
  tierFor,
  vipLine,
} from "@/lib/loyalty-math";
import { pointsFor } from "@/lib/rewards-math";
import { dueFor } from "@/lib/marketing";
import type { Shopper } from "@/lib/loyalty";

const now = new Date("2026-11-27T18:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
const fail = (m: string): never => {
  throw new Error(m);
};

describe("shopper groups", () => {
  const base = { joinedAt: ago(200), visits: 5, lastPurchaseAt: ago(10), spend12m: "300" };
  it("puts every shopper in one group", () => {
    expect(classifySegment(base, now)).toBe("REGULAR");
    expect(classifySegment({ ...base, spend12m: "1200" }, now)).toBe("VIP");
    expect(classifySegment({ ...base, lastPurchaseAt: ago(60) }, now)).toBe("AT_RISK");
    expect(classifySegment({ ...base, lastPurchaseAt: ago(120) }, now)).toBe("LAPSED");
    expect(classifySegment({ ...base, visits: 1, joinedAt: ago(5), lastPurchaseAt: ago(5) }, now)).toBe("NEW");
  });
  it("sends someone who joined and never came back to New, then Lapsed", () => {
    const none = { visits: 0, lastPurchaseAt: null, spend12m: "0" };
    expect(classifySegment({ ...none, joinedAt: ago(10) }, now)).toBe("NEW");
    expect(classifySegment({ ...none, joinedAt: ago(100) }, now)).toBe("LAPSED");
  });
  it("a VIP who stopped coming is no longer a VIP", () => {
    expect(classifySegment({ ...base, spend12m: "5000", lastPurchaseAt: ago(70) }, now)).toBe("AT_RISK");
  });
  it("uses the day boundaries exactly", () => {
    expect(classifySegment({ ...base, lastPurchaseAt: ago(45) }, now)).toBe("REGULAR");
    expect(classifySegment({ ...base, lastPurchaseAt: ago(46) }, now)).toBe("AT_RISK");
    expect(classifySegment({ ...base, lastPurchaseAt: ago(90) }, now)).toBe("AT_RISK");
    expect(classifySegment({ ...base, lastPurchaseAt: ago(91) }, now)).toBe("LAPSED");
  });
});

describe("tiers", () => {
  const tiers = [
    { id: "b", name: "Bronze", minSpend: "0", earnPercent: 100 },
    { id: "s", name: "Silver", minSpend: "500", earnPercent: 110 },
    { id: "g", name: "Gold", minSpend: "1500", earnPercent: 125 },
  ];
  it("picks the highest tier the spending reaches", () => {
    expect(tierFor(tiers, "0")?.name).toBe("Bronze");
    expect(tierFor(tiers, "499.99")?.name).toBe("Bronze");
    expect(tierFor(tiers, "500")?.name).toBe("Silver");
    expect(tierFor(tiers, "9000")?.name).toBe("Gold");
    expect(tierFor([{ ...tiers[1] }], "100")).toBeNull();
  });
  it("says what is left to the next tier", () => {
    expect(nextTier(tiers, "320.50")).toMatchObject({ remaining: "179.50" });
    expect(nextTier(tiers, "320.50")?.tier.name).toBe("Silver");
    expect(nextTier(tiers, "2000")).toBeNull();
  });
  it("sets the VIP line at the top tier, or 1000 with none", () => {
    expect(vipLine(tiers).toString()).toBe("1500");
    expect(vipLine([]).toString()).toBe("1000");
  });
  it("checks tier input in plain words", () => {
    expect(cleanTier({ name: " Gold ", minSpend: "$1,500", earnPercent: "125%" }, fail)).toEqual({ name: "Gold", minSpend: "1500.00", earnPercent: 125, perk: null });
    expect(() => cleanTier({ name: "", minSpend: "1", earnPercent: "100" }, fail)).toThrow(/name/);
    expect(() => cleanTier({ name: "X", minSpend: "abc", earnPercent: "100" }, fail)).toThrow(/dollars/);
    expect(() => cleanTier({ name: "X", minSpend: "5", earnPercent: "50" }, fail)).toThrow(/100/);
  });
});

describe("points speed", () => {
  it("matches the old rule at normal speed", () => {
    for (const paid of ["0", "0.99", "10", "37.49", "123.45"]) expect(pointsAtSpeed(paid, 1, 100)).toBe(pointsFor(paid, 1));
    expect(pointsAtSpeed("37.49", 2, 100)).toBe(pointsFor("37.49", 2));
  });
  it("earns faster with a tier and bonus days, rounding down to whole points", () => {
    expect(pointsAtSpeed("40", 1, 125)).toBe(50);
    expect(pointsAtSpeed("33.33", 1, 200)).toBe(66);
    expect(pointsAtSpeed("0", 1, 500)).toBe(0);
  });
  it("finds the fastest bonus running today, and none outside the dates", () => {
    const boosts = [
      { startDate: "2026-11-27", endDate: "2026-11-30", earnPercent: 200 },
      { startDate: "2026-11-01", endDate: "2026-11-30", earnPercent: 150 },
      { startDate: "2026-11-28", endDate: "2026-11-28", earnPercent: 300, active: false },
    ];
    expect(boostPercent(boosts, "2026-11-27")).toBe(200);
    expect(boostPercent(boosts, "2026-11-28")).toBe(200);
    expect(boostPercent(boosts, "2026-12-01")).toBe(100);
    expect(boostPercent([], "2026-11-27")).toBe(100);
  });
  it("stacks tier and bonus days by multiplying, and never passes ten times", () => {
    expect(combinedPercent(125, 200)).toBe(250);
    expect(combinedPercent(100, 100)).toBe(100);
    expect(combinedPercent(500, 500)).toBe(1000);
  });
  it("checks bonus-day input", () => {
    expect(cleanBoost({ name: "Double day", startDate: "2026-11-28", endDate: "2026-11-29", earnPercent: "200" }, fail)).toMatchObject({ earnPercent: 200 });
    expect(() => cleanBoost({ name: "x", startDate: "2026-11-30", endDate: "2026-11-29", earnPercent: "200" }, fail)).toThrow(/before/);
    expect(() => cleanBoost({ name: "x", startDate: "2026-11-28", endDate: "2026-11-29", earnPercent: "100" }, fail)).toThrow(/101/);
  });
});

describe("quiet hours", () => {
  it("covers a window that runs past midnight", () => {
    expect(isQuietTime("22:30", "21:00", "08:00")).toBe(true);
    expect(isQuietTime("03:00", "21:00", "08:00")).toBe(true);
    expect(isQuietTime("08:00", "21:00", "08:00")).toBe(false);
    expect(isQuietTime("12:00", "21:00", "08:00")).toBe(false);
    expect(isQuietTime("20:59", "21:00", "08:00")).toBe(false);
  });
  it("covers a same-day window and an empty one", () => {
    expect(isQuietTime("13:00", "12:00", "14:00")).toBe(true);
    expect(isQuietTime("15:00", "12:00", "14:00")).toBe(false);
    expect(isQuietTime("03:00", "08:00", "08:00")).toBe(false);
  });
});

describe("small helpers", () => {
  it("fills merge fields and leaves unknown ones", () => {
    const text = renderTemplate("Hi {first_name}, {points} pts at {shop}. {card_link} {referral_code} {nope}", { firstName: "Ana", shop: "Sunny", points: 1234, cardLink: "https://x/c/1", referralCode: "ABC234" });
    expect(text).toBe("Hi Ana, 1,234 pts at Sunny. https://x/c/1 ABC234 {nope}");
  });
  it("makes referral codes from the safe alphabet", () => {
    const code = codeFromBytes(new Uint8Array([0, 1, 2, 3, 250, 255]));
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]+$/);
    expect(code).not.toMatch(/[01OIL]/);
  });
  it("checks emails and cleans tags", () => {
    expect(normalizeEmail(" Ana@Example.COM ")).toBe("ana@example.com");
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(cleanTags("VIP, edibles , vip, Big Spender!!")).toEqual(["vip", "edibles", "big-spender"]);
  });
  it("works out what a brand owes", () => {
    expect(brandOwes("120.00", 50)).toBe("60.00");
    expect(brandOwes("33.33", 33)).toBe("11.00");
    expect(brandOwes("0", 100)).toBe("0.00");
  });
});

describe("who is due an automatic message", () => {
  const shopper = (over: Partial<Shopper>): Shopper => ({
    id: "m",
    firstName: "Ana",
    phone: "5055550101",
    email: null,
    points: 0,
    birthday: null,
    joinedAt: ago(100),
    lastActivityAt: ago(1),
    tags: [],
    visits: 3,
    lastPurchaseAt: ago(10),
    spend12m: "0",
    lifetime: "0",
    segment: "REGULAR",
    tier: null,
    ...over,
  });
  it("welcomes people the day after they join, for a week", () => {
    expect(dueFor("WELCOME", shopper({ joinedAt: ago(0) }), "2026-11-27", now)).toBe(false);
    expect(dueFor("WELCOME", shopper({ joinedAt: ago(1) }), "2026-11-27", now)).toBe(true);
    expect(dueFor("WELCOME", shopper({ joinedAt: ago(8) }), "2026-11-27", now)).toBe(false);
  });
  it("nudges a one-time buyer who hasn't been back in two weeks", () => {
    expect(dueFor("SECOND_VISIT", shopper({ visits: 1, lastPurchaseAt: ago(14) }), "2026-11-27", now)).toBe(true);
    expect(dueFor("SECOND_VISIT", shopper({ visits: 1, lastPurchaseAt: ago(5) }), "2026-11-27", now)).toBe(false);
    expect(dueFor("SECOND_VISIT", shopper({ visits: 2, lastPurchaseAt: ago(20) }), "2026-11-27", now)).toBe(false);
  });
  it("wishes a happy birthday in the birthday month", () => {
    expect(dueFor("BIRTHDAY", shopper({ birthday: "11-03" }), "2026-11-27", now)).toBe(true);
    expect(dueFor("BIRTHDAY", shopper({ birthday: "12-03" }), "2026-11-27", now)).toBe(false);
    expect(dueFor("BIRTHDAY", shopper({ birthday: null }), "2026-11-27", now)).toBe(false);
  });
  it("wins back at 30, 60 and 90 days, in a window that survives a missed day", () => {
    expect(dueFor("WIN_BACK_30", shopper({ lastPurchaseAt: ago(30) }), "2026-11-27", now)).toBe(true);
    expect(dueFor("WIN_BACK_30", shopper({ lastPurchaseAt: ago(44) }), "2026-11-27", now)).toBe(true);
    expect(dueFor("WIN_BACK_30", shopper({ lastPurchaseAt: ago(45) }), "2026-11-27", now)).toBe(false);
    expect(dueFor("WIN_BACK_60", shopper({ lastPurchaseAt: ago(61) }), "2026-11-27", now)).toBe(true);
    expect(dueFor("WIN_BACK_90", shopper({ lastPurchaseAt: ago(95) }), "2026-11-27", now)).toBe(true);
    expect(dueFor("WIN_BACK_90", shopper({ lastPurchaseAt: null, visits: 0 }), "2026-11-27", now)).toBe(false);
  });
});

import { eligibleShare, NO_EXCLUSIONS, parseFavorite, speedFor } from "@/lib/loyalty-math";

describe("margin protection and stacking", () => {
  it("stacks by multiplying, or takes only the better one", () => {
    expect(speedFor(125, 200, "MULTIPLY")).toBe(250);
    expect(speedFor(125, 200, "BEST")).toBe(200);
    expect(speedFor(150, 100, "BEST")).toBe(150);
    expect(speedFor(100, 100, "BEST")).toBe(100);
    expect(speedFor(900, 900, "MULTIPLY")).toBe(1000);
  });
  it("works out the share of a cart that is eligible", () => {
    const lines = [
      { itemId: "a", categoryId: "flower", quantity: "1", unitPrice: "40" },
      { itemId: "b", categoryId: "vape", quantity: "2", unitPrice: "30" },
      { itemId: "c", categoryId: "edible", quantity: "1", unitPrice: "20" },
    ];
    expect(eligibleShare(lines, NO_EXCLUSIONS).toString()).toBe("1");
    expect(eligibleShare(lines, { categories: new Set(["vape"]), items: new Set() }).toString()).toBe("0.5");
    expect(eligibleShare(lines, { categories: new Set(), items: new Set(["c"]) }).toFixed(4)).toBe("0.8333");
    expect(eligibleShare(lines, { categories: new Set(["flower", "vape", "edible"]), items: new Set() }).toString()).toBe("0");
    expect(eligibleShare([], NO_EXCLUSIONS).toString()).toBe("1");
  });
  it("reads category-buyer groups with a time window", () => {
    expect(parseFavorite("FAVORITE:abc-123")).toEqual({ categoryId: "abc-123", days: 365 });
    expect(parseFavorite("FAVORITE:abc-123:30")).toEqual({ categoryId: "abc-123", days: 30 });
    expect(parseFavorite("FAVORITE:abc:0")).toBeNull();
    expect(parseFavorite("FAVORITE:abc:999")).toBeNull();
    expect(parseFavorite("VIP")).toBeNull();
  });
});
