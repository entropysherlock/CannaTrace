import Decimal from "decimal.js";
import { InventoryError } from "./inventory-math";

export type LimitCategory = "NONE" | "FLOWER" | "CONCENTRATE" | "EDIBLE";
export type CustomerType = "ADULT_USE" | "MEDICAL";

const round2 = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const LIMIT_LABELS: Record<Exclude<LimitCategory, "NONE">, { name: string; unit: string }> = {
  FLOWER: { name: "Flower", unit: "g" },
  CONCENTRATE: { name: "Concentrate", unit: "g" },
  EDIBLE: { name: "Edible THC", unit: "mg" },
};

/** Whole years between a birth date and today, both as YYYY-MM-DD. */
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** Why this person cannot be served, or null when they can. */
export function checkInProblem(
  input: { birthDate: string; idExpires: string; customerType: CustomerType },
  rules: { adultMinAge: number; medicalMinAge: number },
  today: string,
): string | null {
  if (input.birthDate > today) return "That birth date is in the future. Check the ID again.";
  if (input.idExpires < today) return `This ID expired on ${input.idExpires}. An expired ID cannot be accepted.`;
  const age = ageOn(input.birthDate, today);
  const min = input.customerType === "MEDICAL" ? rules.medicalMinAge : rules.adultMinAge;
  if (age < min) return `This customer is ${age}. The minimum age is ${min}. Do not complete a sale.`;
  if (age > 120) return "That birth date makes the customer over 120. Check the ID again.";
  return null;
}

export type CartLine = {
  itemName: string;
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  limitCategory: LimitCategory;
  limitPerUnit: Decimal.Value | null;
};

export type Limits = { FLOWER: Decimal; CONCENTRATE: Decimal; EDIBLE: Decimal };

/** How much of each limited category is in the cart. */
export function limitUsage(lines: Pick<CartLine, "quantity" | "limitCategory" | "limitPerUnit">[]): Limits {
  const usage: Limits = { FLOWER: new Decimal(0), CONCENTRATE: new Decimal(0), EDIBLE: new Decimal(0) };
  for (const line of lines) {
    if (line.limitCategory === "NONE" || line.limitPerUnit === null) continue;
    usage[line.limitCategory] = usage[line.limitCategory].add(new Decimal(line.quantity).mul(line.limitPerUnit));
  }
  return usage;
}

/** The first purchase limit the cart breaks, as a message for the budtender, or null when it is within limits. */
export function limitProblem(usage: Limits, limits: Limits): string | null {
  for (const category of ["FLOWER", "CONCENTRATE", "EDIBLE"] as const) {
    if (usage[category].gt(limits[category])) {
      const { name, unit } = LIMIT_LABELS[category];
      return `That puts the cart at ${usage[category].toString()} ${unit} of ${name.toLowerCase()}. The limit is ${limits[category].toString()} ${unit} per purchase.`;
    }
  }
  return null;
}

export type Totals = {
  subtotal: Decimal;
  discount: Decimal;
  taxable: Decimal;
  exciseTax: Decimal;
  salesTax: Decimal;
  total: Decimal;
};

/**
 * Cart totals. The discount comes off the subtotal first; each tax is then worked out
 * on the discounted amount and rounded to the cent on its own.
 */
export function cartTotals(
  lines: Pick<CartLine, "quantity" | "unitPrice">[],
  options: { discountPercent: Decimal.Value; exciseTaxPercent: Decimal.Value; salesTaxPercent: Decimal.Value; taxExempt: boolean },
): Totals {
  const subtotal = lines.reduce((sum, line) => sum.add(round2(new Decimal(line.quantity).mul(line.unitPrice))), new Decimal(0));
  const discount = round2(subtotal.mul(options.discountPercent).div(100));
  const taxable = subtotal.sub(discount);
  const exciseTax = options.taxExempt ? new Decimal(0) : round2(taxable.mul(options.exciseTaxPercent).div(100));
  const salesTax = options.taxExempt ? new Decimal(0) : round2(taxable.mul(options.salesTaxPercent).div(100));
  return { subtotal, discount, taxable, exciseTax, salesTax, total: taxable.add(exciseTax).add(salesTax) };
}

export function parsePercent(input: unknown, what: string, max = 100): Decimal {
  const text = String(input ?? "").trim().replace(/%$/, "");
  if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new InventoryError(`${what} must be a percentage such as 10 or 7.625.`);
  const value = new Decimal(text);
  if (value.gt(max)) throw new InventoryError(`${what} cannot be more than ${max}%.`);
  return value;
}

/** Change owed on a cash payment. Throws when the customer has not handed over enough. */
export function changeDue(total: Decimal, tendered: Decimal): Decimal {
  if (tendered.lt(total)) {
    throw new InventoryError(`The total is $${total.toFixed(2)} but only $${tendered.toFixed(2)} was handed over.`);
  }
  return tendered.sub(total);
}

/** What should be in the till: the float plus cash sales (change already given back). */
export function expectedCash(openingCash: Decimal.Value, cashSaleTotals: Decimal.Value[]): Decimal {
  return cashSaleTotals.reduce<Decimal>((sum, total) => sum.add(total), new Decimal(openingCash));
}
