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
      return `That puts the cart at ${usage[category].toString()} ${unit} of ${name.toLowerCase().replace("thc", "THC")}. The limit is ${limits[category].toString()} ${unit} per purchase.`;
    }
  }
  return null;
}

export type Totals = {
  subtotal: Decimal;
  /** Dollars off from automatic promotions, taken first. */
  promo: Decimal;
  /** The percent discount, taken off what the promotions left. */
  discount: Decimal;
  /** Dollars off from rewards points, after the percent discount and before tax. */
  reward: Decimal;
  taxable: Decimal;
  exciseTax: Decimal;
  salesTax: Decimal;
  total: Decimal;
};

/**
 * Cart totals. Automatic promotions come off first, then the percent discount comes off what is left, then any rewards dollars (already capped by
 * the rewards rules, and never more than what's left); each tax is then worked out on what remains and rounded
 * to the cent on its own.
 */
export function cartTotals(
  lines: Pick<CartLine, "quantity" | "unitPrice">[],
  options: { discountPercent: Decimal.Value; exciseTaxPercent: Decimal.Value; salesTaxPercent: Decimal.Value; taxExempt: boolean; rewardDiscount?: Decimal.Value; promoDiscount?: Decimal.Value },
): Totals {
  const subtotal = lines.reduce((sum, line) => sum.add(round2(new Decimal(line.quantity).mul(line.unitPrice))), new Decimal(0));
  const promo = Decimal.max(0, Decimal.min(round2(new Decimal(options.promoDiscount ?? 0)), subtotal));
  const discount = round2(subtotal.sub(promo).mul(options.discountPercent).div(100));
  const afterDiscount = subtotal.sub(promo).sub(discount);
  const reward = Decimal.max(0, Decimal.min(round2(new Decimal(options.rewardDiscount ?? 0)), afterDiscount));
  const taxable = afterDiscount.sub(reward);
  const exciseTax = options.taxExempt ? new Decimal(0) : round2(taxable.mul(options.exciseTaxPercent).div(100));
  const salesTax = options.taxExempt ? new Decimal(0) : round2(taxable.mul(options.salesTaxPercent).div(100));
  return { subtotal, promo, discount, reward, taxable, exciseTax, salesTax, total: taxable.add(exciseTax).add(salesTax) };
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

/** What should be in the till: the float plus the cash kept from each sale (change already given back). */
export function expectedCash(openingCash: Decimal.Value, cashKept: Decimal.Value[]): Decimal {
  return cashKept.reduce<Decimal>((sum, total) => sum.add(total), new Decimal(openingCash));
}

export type PaymentMethod = "CASH" | "DEBIT" | "SPLIT";

export type Settlement = {
  /** Cash the customer handed over, or null when none was. */
  cashTendered: Decimal | null;
  /** Charged to the customer's debit card. */
  debit: Decimal;
  /** Cash that stays in the till: the cash share of the total. */
  cashKept: Decimal;
  changeDue: Decimal;
};

/**
 * Work out a payment. Cash pays the whole total; debit pays the whole total; split puts part on
 * debit and the rest in cash. Throws a message for the budtender when the amounts do not cover the total.
 */
export function settlePayment(total: Decimal, method: PaymentMethod, amounts: { cashTendered?: Decimal | null; debit?: Decimal | null }): Settlement {
  if (method === "DEBIT") return { cashTendered: null, debit: total, cashKept: new Decimal(0), changeDue: new Decimal(0) };
  if (method === "CASH") {
    const tendered = amounts.cashTendered ?? new Decimal(0);
    return { cashTendered: tendered, debit: new Decimal(0), cashKept: total, changeDue: changeDue(total, tendered) };
  }
  const debit = amounts.debit ?? new Decimal(0);
  if (debit.lte(0)) throw new InventoryError("Enter how much goes on the debit card.");
  if (debit.gte(total)) throw new InventoryError(`The debit part must be less than the total of $${total.toFixed(2)}. To put it all on the card, choose Debit.`);
  const cashShare = total.sub(debit);
  const tendered = amounts.cashTendered ?? new Decimal(0);
  if (tendered.lt(cashShare)) {
    throw new InventoryError(`After $${debit.toFixed(2)} on debit, $${cashShare.toFixed(2)} is due in cash, but only $${tendered.toFixed(2)} was handed over.`);
  }
  return { cashTendered: tendered, debit, cashKept: cashShare, changeDue: tendered.sub(cashShare) };
}

/** Quick cash amounts a customer is likely to hand over for this total: exact, then the next round bills. */
export function quickCashAmounts(total: Decimal.Value): string[] {
  const t = new Decimal(total);
  if (t.lte(0)) return [];
  const out = new Set<string>([t.toFixed(2)]);
  for (const step of [5, 10, 20, 50, 100]) {
    const next = t.div(step).ceil().mul(step);
    if (next.gt(t)) out.add(next.toFixed(2));
  }
  return [...out].sort((a, b) => Number(a) - Number(b)).slice(0, 5);
}

/** idNumber: the ID's own number (AAMVA field DAQ), used only to count daily purchase limits. */
export type IdScan = { firstName: string | null; lastName: string | null; birthDate: string; idExpires: string; state: string | null; idNumber: string | null };

/** A YYYY-MM-DD date from an AAMVA 8-digit date, which is MMDDCCYY in the US and CCYYMMDD in Canada. */
function aamvaDate(raw: string | undefined, canadian: boolean): string | null {
  const d = raw?.replace(/\D/g, "");
  if (!d || d.length !== 8) return null;
  const valid = (y: number, m: number, day: number) => y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && day >= 1 && day <= 31;
  const asUs = [Number(d.slice(4)), Number(d.slice(0, 2)), Number(d.slice(2, 4))] as const;
  const asCa = [Number(d.slice(0, 4)), Number(d.slice(4, 6)), Number(d.slice(6))] as const;
  const pick = canadian ? (valid(...asCa) ? asCa : valid(...asUs) ? asUs : null) : valid(...asUs) ? asUs : valid(...asCa) ? asCa : null;
  if (!pick) return null;
  const [y, m, day] = pick;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Read the barcode on the back of a US or Canadian driver's license or state ID (the AAMVA PDF417
 * format that ID scanners output). Returns null when the text is not an ID barcode or lacks the dates.
 */
export function parseIdBarcode(raw: string): IdScan | null {
  if (!/ANSI|AAMVA/.test(raw) || !raw.includes("DBB")) return null;
  // Dates are found by pattern, so this works even when a scanner drops the line breaks.
  const canadian = /DCGCAN/.test(raw);
  const birthDate = aamvaDate(/DBB(\d{8})/.exec(raw)?.[1], canadian);
  const idExpires = aamvaDate(/DBA(\d{8})/.exec(raw)?.[1], canadian);
  if (!birthDate || !idExpires) return null;
  // Names need the line breaks: each field is on its own line, the first one glued to the subfile header.
  const fields = new Map<string, string>();
  for (const part of raw.split(/[\r\n\x1e\x1d]+/)) {
    const match = /^(?:.*?(?:DL|ID))?(D[A-Z]{2})(.*)$/.exec(part.trim());
    if (match && !fields.has(match[1])) fields.set(match[1], match[2].trim());
  }
  const title = (v: string | null | undefined) =>
    v && v !== "NONE" && v !== "unavl" ? v.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : null;
  let first = fields.get("DAC") ?? null;
  let last = fields.get("DCS") ?? null;
  // Older cards put the whole name in DAA as LAST,FIRST,MIDDLE.
  if (!first && !last && fields.get("DAA")) [last, first] = fields.get("DAA")!.split(/[,$]/);
  const state = /DAJ([A-Z]{2})/.exec(raw)?.[1] ?? null;
  const idNumber = fields.get("DAQ")?.replace(/[^A-Za-z0-9]/g, "") || null;
  return { firstName: title(first), lastName: title(last), birthDate, idExpires, state, idNumber: idNumber && idNumber.length >= 4 ? idNumber : null };
}

/**
 * Optional details of a card payment, typed from the store's own card terminal so the sale can be matched to
 * the terminal's batch report: the last 4 digits and the approval number. Never a full card number.
 */
export function cleanCardDetails(input: { cardLast4?: unknown; cardRef?: unknown }): { cardLast4: string | null; cardRef: string | null } {
  const last4 = String(input.cardLast4 ?? "").trim();
  const ref = String(input.cardRef ?? "").trim();
  if (last4 && !/^\d{4}$/.test(last4)) throw new InventoryError("Enter only the last 4 digits of the card, or leave it blank. Never type the whole card number.");
  if (ref.length > 24 || !/^[A-Za-z0-9 -]*$/.test(ref)) throw new InventoryError("The approval number can use letters, numbers and dashes, up to 24 characters.");
  return { cardLast4: last4 || null, cardRef: ref || null };
}
