/**
 * CannaTrace pricing, in one place: one plan with every feature, priced by how many facilities
 * (licenses) a business runs. The pricing page reads these, and the sales sheet, demo script,
 * and partner agreement quote the same numbers.
 */

export type Price = {
  facilities: number;
  /** US dollars a month. */
  price: number;
  /** The founding-customer price, for life: $100 off. */
  founderPrice: number;
};

export const PRICES: Price[] = [
  { facilities: 1, price: 299, founderPrice: 199 },
  { facilities: 2, price: 499, founderPrice: 399 },
];

export const FOUNDING = {
  spots: 5,
  freeDays: 60,
  perks: ["60 days free", "$100 off every month, for life", "We set it up and bring your inventory over for you"],
};

/** Everything comes with every plan. */
export const FEATURES = [
  "Plants, batches, and harvests, with IDs made for you",
  "Inventory, lab results, counts, and audit trail",
  "SmartLabel AI: New Mexico product and package labels",
  "Manufacturing: recipes, runs, yield, and cost per unit",
  "Wholesale: orders, picking, manifests, and invoices",
  "Register for retail sales, with purchase limits",
  "Tally, the built-in assistant, and Tally Watch",
  "Show me how guided walkthroughs",
  "Switch from NMS2S, Dutchie, or Flourish",
  "Unlimited team members",
];

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
export const facilitiesLabel = (n: number) => `${n} ${n === 1 ? "facility" : "facilities"}`;
