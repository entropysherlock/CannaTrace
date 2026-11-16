import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { InventoryError } from "../src/lib/inventory-math";
import { ageOn, cartTotals, changeDue, checkInProblem, expectedCash, limitProblem, limitUsage, parsePercent } from "../src/lib/pos-math";

const rules = { adultMinAge: 21, medicalMinAge: 18 };
const today = "2026-11-16";

describe("age check", () => {
  it("counts whole years, including the birthday itself and leap days", () => {
    expect(ageOn("2005-11-16", today)).toBe(21);
    expect(ageOn("2005-11-17", today)).toBe(20);
    expect(ageOn("2004-02-29", "2025-02-28")).toBe(20);
    expect(ageOn("2004-02-29", "2025-03-01")).toBe(21);
  });
  it("serves a 21st birthday and refuses the day before", () => {
    const base = { idExpires: "2030-01-01", customerType: "ADULT_USE" as const };
    expect(checkInProblem({ ...base, birthDate: "2005-11-16" }, rules, today)).toBeNull();
    expect(checkInProblem({ ...base, birthDate: "2005-11-17" }, rules, today)).toMatch(/is 20\. The minimum age is 21/);
  });
  it("uses the medical minimum age for patients", () => {
    const patient = { birthDate: "2007-06-01", idExpires: "2030-01-01", customerType: "MEDICAL" as const };
    expect(checkInProblem(patient, rules, today)).toBeNull();
    expect(checkInProblem({ ...patient, customerType: "ADULT_USE" }, rules, today)).toMatch(/minimum age is 21/);
  });
  it("refuses expired IDs and impossible birth dates", () => {
    expect(checkInProblem({ birthDate: "1990-01-01", idExpires: "2026-11-15", customerType: "ADULT_USE" }, rules, today)).toMatch(/expired/);
    expect(checkInProblem({ birthDate: "1990-01-01", idExpires: today, customerType: "ADULT_USE" }, rules, today)).toBeNull();
    expect(checkInProblem({ birthDate: "2027-01-01", idExpires: "2030-01-01", customerType: "ADULT_USE" }, rules, today)).toMatch(/future/);
    expect(checkInProblem({ birthDate: "1890-01-01", idExpires: "2030-01-01", customerType: "ADULT_USE" }, rules, today)).toMatch(/over 120/);
  });
});

describe("purchase limits", () => {
  const limits = { FLOWER: new Decimal("56.7"), CONCENTRATE: new Decimal(16), EDIBLE: new Decimal(800) };
  const jar = { limitCategory: "FLOWER" as const, limitPerUnit: "3.5" };
  const gummies = { limitCategory: "EDIBLE" as const, limitPerUnit: "100" };
  it("adds up each category separately and ignores unlimited items", () => {
    const usage = limitUsage([
      { ...jar, quantity: "4" },
      { limitCategory: "FLOWER", limitPerUnit: "1", quantity: "2" },
      { ...gummies, quantity: "3" },
      { limitCategory: "NONE", limitPerUnit: null, quantity: "50" },
    ]);
    expect(usage.FLOWER.toString()).toBe("16");
    expect(usage.EDIBLE.toString()).toBe("300");
    expect(usage.CONCENTRATE.toString()).toBe("0");
    expect(limitProblem(usage, limits)).toBeNull();
  });
  it("allows exactly the limit and refuses anything over", () => {
    expect(limitProblem(limitUsage([{ ...jar, quantity: "16" }, { limitCategory: "FLOWER", limitPerUnit: "1", quantity: "0.7" }]), limits)).toBeNull();
    expect(limitProblem(limitUsage([{ ...jar, quantity: "17" }]), limits)).toBe(
      "That puts the cart at 59.5 g of flower. The limit is 56.7 g per purchase.",
    );
    expect(limitProblem(limitUsage([{ ...gummies, quantity: "9" }]), limits)).toMatch(/900 mg of edible thc. The limit is 800 mg/);
  });
});

describe("cart totals", () => {
  const lines = [
    { quantity: "2", unitPrice: "35" },
    { quantity: "3", unitPrice: "8.33" },
  ];
  it("takes the discount first, then taxes the discounted amount", () => {
    const t = cartTotals(lines, { discountPercent: "10", exciseTaxPercent: "14", salesTaxPercent: "7.625", taxExempt: false });
    expect(t.subtotal.toString()).toBe("94.99");
    expect(t.discount.toString()).toBe("9.5");
    expect(t.taxable.toString()).toBe("85.49");
    expect(t.exciseTax.toString()).toBe("11.97");
    expect(t.salesTax.toString()).toBe("6.52");
    expect(t.total.toString()).toBe("103.98");
  });
  it("charges no tax when exempt", () => {
    const t = cartTotals(lines, { discountPercent: "0", exciseTaxPercent: "14", salesTaxPercent: "7.625", taxExempt: true });
    expect(t.total.toString()).toBe("94.99");
    expect(t.exciseTax.isZero() && t.salesTax.isZero()).toBe(true);
  });
  it("handles an empty cart", () => {
    expect(cartTotals([], { discountPercent: "0", exciseTaxPercent: "14", salesTaxPercent: "7", taxExempt: false }).total.toString()).toBe("0");
  });
});

describe("cash", () => {
  it("gives change and refuses short payment", () => {
    expect(changeDue(new Decimal("103.98"), new Decimal(120)).toString()).toBe("16.02");
    expect(changeDue(new Decimal("103.98"), new Decimal("103.98")).toString()).toBe("0");
    expect(() => changeDue(new Decimal("103.98"), new Decimal(100))).toThrow(/only \$100.00 was handed over/);
  });
  it("expects the float plus cash sales in the till", () => {
    expect(expectedCash("200", ["103.98", "40.02"]).toString()).toBe("344");
  });
  it("parses percentages", () => {
    expect(parsePercent("7.625%", "Tax").toString()).toBe("7.625");
    expect(() => parsePercent("101", "Discount")).toThrow(InventoryError);
    expect(() => parsePercent("-1", "Discount")).toThrow(InventoryError);
  });
});
