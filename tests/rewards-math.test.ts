import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRAM,
  cleanProgram,
  giveBackPercent,
  isBirthdayMonth,
  normalizePhone,
  parseBirthday,
  pointsExpired,
  pointsFor,
  pointsToTakeBack,
  rewardsAvailable,
  rewardsThatFit,
} from "@/lib/rewards-math";

const fail = (m: string): never => {
  throw new Error(m);
};

describe("New Mexico: a reward can never make cannabis free", () => {
  it("fits rewards under the cap and always leaves something to pay", () => {
    // $5 rewards, 50% cap: a $40 cart can take $20 (4 rewards); a $9 cart only $4.50, so none.
    expect(rewardsThatFit(10, "40", DEFAULT_PROGRAM)).toBe(4);
    expect(rewardsThatFit(1, "9", DEFAULT_PROGRAM)).toBe(0);
    expect(rewardsThatFit(1, "10", DEFAULT_PROGRAM)).toBe(1);
    // Even a store at the 90% ceiling can't cover a whole cart.
    expect(rewardsThatFit(5, "5", { redeemDollars: "5", maxSharePercent: 100 })).toBe(0);
    expect(rewardsThatFit(5, "100", { redeemDollars: "5", maxSharePercent: 100 })).toBe(5);
    expect(rewardsThatFit(99, "100", { redeemDollars: "5", maxSharePercent: 100 })).toBe(18);
  });
  it("is limited by the shopper's points too", () => {
    expect(rewardsAvailable(250, "100", DEFAULT_PROGRAM)).toBe(2);
    expect(rewardsAvailable(99, "100", DEFAULT_PROGRAM)).toBe(0);
    expect(rewardsAvailable(1000, "30", DEFAULT_PROGRAM)).toBe(3);
  });
});

describe("earning and taking back points", () => {
  it("earns whole points on what was paid before tax", () => {
    expect(pointsFor("45.99", 1)).toBe(45);
    expect(pointsFor("10", 5)).toBe(50);
    expect(pointsFor("0", 1)).toBe(0);
  });
  it("takes back the refunded share, and the rest on the final return", () => {
    expect(pointsToTakeBack(100, 0, "25", "100", false)).toBe(25);
    expect(pointsToTakeBack(100, 25, "50", "100", false)).toBe(50);
    expect(pointsToTakeBack(100, 75, "25", "100", true)).toBe(25);
    expect(pointsToTakeBack(100, 100, "1", "100", false)).toBe(0);
  });
  it("works out the give-back rate: industry standard is 5%", () => {
    expect(giveBackPercent(DEFAULT_PROGRAM)).toBe("5");
    expect(giveBackPercent({ pointsPerDollar: 1, redeemPoints: 100, redeemDollars: "3" })).toBe("3");
  });
});

describe("shopper details", () => {
  it("reads US phone numbers however they're typed", () => {
    expect(normalizePhone("(505) 555-0142")).toBe("5055550142");
    expect(normalizePhone("1-505-555-0142")).toBe("5055550142");
    expect(normalizePhone("555-0142")).toBeNull();
    expect(normalizePhone("0505550142")).toBeNull();
  });
  it("keeps only month and day of a birthday", () => {
    expect(parseBirthday("3/14")).toBe("03-14");
    expect(parseBirthday("03-14-1990")).toBe("03-14");
    expect(parseBirthday("1990-03-14")).toBe("03-14");
    expect(parseBirthday("March 14")).toBe("03-14");
    expect(parseBirthday("2/29")).toBe("02-29");
    expect(parseBirthday("2/30")).toBeNull();
    expect(parseBirthday("")).toBe("none");
    expect(isBirthdayMonth("03-14", "2026-03-02")).toBe(true);
    expect(isBirthdayMonth("03-14", "2026-04-02")).toBe(false);
  });
  it("expires points after the set months of no purchases", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    expect(pointsExpired(new Date("2025-11-01T00:00:00Z"), now, 12)).toBe(true);
    expect(pointsExpired(new Date("2026-01-01T00:00:00Z"), now, 12)).toBe(false);
    expect(pointsExpired(new Date("2020-01-01T00:00:00Z"), now, 0)).toBe(false);
  });
  it("checks a store's settings in plain English", () => {
    const ok = cleanProgram(
      { enabled: "on", pointsPerDollar: "1", redeemPoints: "100", redeemDollars: "$5", signupBonus: "25", birthdayBonus: "50", expireMonths: "12", maxSharePercent: "50" },
      fail,
    );
    expect(ok).toEqual({ ...DEFAULT_PROGRAM, enabled: true });
    expect(() => cleanProgram({ ...ok, maxSharePercent: "100" } as never, fail)).toThrow(/between 1 and 90/);
    expect(() => cleanProgram({ ...ok, redeemDollars: "five" } as never, fail)).toThrow(/dollar amount/);
  });
});
