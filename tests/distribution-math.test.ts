import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  addDays,
  formatNumber,
  invoiceBalance,
  licenseProblem,
  lineTotal,
  orderTotal,
  parseDate,
  parseMoney,
  parsePrice,
  todayIn,
} from "../src/lib/distribution-math";
import { InventoryError } from "../src/lib/inventory-math";

describe("money parsing", () => {
  it("accepts dollars with optional $ and commas", () => {
    expect(parseMoney("$1,250.50").toString()).toBe("1250.5");
    expect(parseMoney("40").toString()).toBe("40");
  });
  it.each(["", "abc", "-5", "1.999", "1e3", "0"])("rejects %j", (value) => {
    expect(() => parseMoney(value)).toThrow(InventoryError);
  });
  it("allows zero only when asked", () => {
    expect(parseMoney("0", "Amount", { allowZero: true }).isZero()).toBe(true);
  });
  it("lets prices carry four decimals but not five", () => {
    expect(parsePrice("0.0825").toString()).toBe("0.0825");
    expect(() => parsePrice("0.08255")).toThrow(InventoryError);
  });
});

describe("totals", () => {
  it("rounds each line to cents, half up", () => {
    expect(lineTotal("3", "0.335").toString()).toBe("1.01"); // 1.005 rounds up
    expect(lineTotal("28.3495", "4.5").toString()).toBe("127.57");
  });
  it("sums rounded lines", () => {
    expect(orderTotal([{ quantity: "96", unitPrice: "12.5" }, { quantity: "200", unitPrice: "2.75" }]).toString()).toBe("1750");
  });
});

describe("invoice balance", () => {
  it("moves from open to partial to paid", () => {
    expect(invoiceBalance("1750", []).state).toBe("OPEN");
    const partial = invoiceBalance("1750", ["500", "250.25"]);
    expect(partial.state).toBe("PARTIAL");
    expect(partial.balance.toString()).toBe("999.75");
    expect(invoiceBalance("1750", ["1000", new Decimal(750)]).state).toBe("PAID");
  });
});

describe("dates", () => {
  it("validates real dates", () => {
    expect(parseDate("2028-02-29", "Date")).toBe("2028-02-29");
    expect(() => parseDate("2027-02-29", "Date")).toThrow(/real date/);
    expect(() => parseDate("11/16/2026", "Date")).toThrow(InventoryError);
  });
  it("adds payment terms across month and year ends", () => {
    expect(addDays("2026-12-15", 30)).toBe("2027-01-14");
    expect(addDays("2026-11-16", 0)).toBe("2026-11-16");
  });
  it("uses the facility time zone for today", () => {
    expect(todayIn("America/Denver", new Date("2026-11-17T03:00:00Z"))).toBe("2026-11-16");
  });
});

describe("license check", () => {
  const ok = { name: "Shop", active: true, licenseExpires: "2027-06-30", licenseVerifiedAt: new Date() };
  it("passes a verified, unexpired, active customer", () => {
    expect(licenseProblem(ok, "2026-11-16")).toBeNull();
    expect(licenseProblem({ ...ok, licenseExpires: "2026-11-16" }, "2026-11-16")).toBeNull(); // valid through its last day
  });
  it("explains each reason it fails", () => {
    expect(licenseProblem({ ...ok, licenseVerifiedAt: null }, "2026-11-16")).toMatch(/not been verified/);
    expect(licenseProblem({ ...ok, licenseExpires: "2026-11-15" }, "2026-11-16")).toMatch(/expired on 2026-11-15/);
    expect(licenseProblem({ ...ok, active: false }, "2026-11-16")).toMatch(/inactive/);
  });
});

it("formats running numbers", () => {
  expect(formatNumber("SO", 42)).toBe("SO-00042");
});
