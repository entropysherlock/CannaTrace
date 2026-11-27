/**
 * Leaf2Sale pricing, in one place: one plan with every feature, one price per facility (license),
 * unlimited users. No tiers, no multi-facility discounts, no trials or founder offers. The landing
 * page, the pricing page, and their search-engine data all read from here.
 */

/** US dollars a month, for each facility. */
export const PRICE_PER_FACILITY = 299;

/** Everything comes with every facility. */
export const FEATURES = [
  "Plants, batches, and harvests, with IDs made for you",
  "Inventory, lab results, counts, and audit trail",
  "Purchase orders, received in one click",
  "SmartLabel AI: New Mexico product and package labels",
  "Manufacturing: recipes, runs, yield, and cost per unit",
  "Wholesale: orders, picking, manifests, and invoices",
  "QuickBooks Online: itemized invoices and payments",
  "Register for retail sales, with purchase limits",
  "Tally, the built-in assistant, Tally Watch, and Take over mode",
  "Show me how guided walkthroughs",
  "Switch from NMS2S, Dutchie, or Flourish",
  "Unlimited users",
];

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The price in one sentence, for the homepage FAQ and the pricing page's description. */
export function priceSentence(): string {
  return `${usd(PRICE_PER_FACILITY)} a month per facility, with every feature and unlimited users. No contract; pay month to month.`;
}
