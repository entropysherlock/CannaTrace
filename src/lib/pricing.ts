/**
 * CannaTrace plans and the founding-customer offer, in one place: the pricing page reads these,
 * and the sales sheet, demo script, and partner agreement quote the same numbers.
 */

export type Plan = {
  id: "starter" | "pro";
  name: string;
  /** US dollars a month, per license. */
  price: number;
  /** The founding-customer price, for life. */
  founderPrice: number;
  forWho: string;
  features: string[];
};

export const FOUNDING = {
  spots: 5,
  freeDays: 60,
  perks: ["60 days free", "About half price for life", "We set it up and bring your inventory over for you"],
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 199,
    founderPrice: 99,
    forWho: "Growers and small producers",
    features: [
      "Plants, batches, and harvests, with IDs made for you",
      "Inventory, lab results, counts, and audit trail",
      "SmartLabel AI: New Mexico product and package labels",
      "Tally, the built-in assistant",
      "Show me how guided walkthroughs",
      "Switch from NMS2S, Dutchie, or Flourish",
      "Up to 10 team members",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 399,
    founderPrice: 199,
    forWho: "Manufacturers, distributors, retailers, and microbusinesses",
    features: [
      "Everything in Starter",
      "Manufacturing: recipes, runs, yield, and cost per unit",
      "Wholesale: orders, picking, manifests, and invoices",
      "Register for retail sales, with purchase limits",
      "Tally Watch: checks your business on its own",
      "Unlimited team members",
    ],
  },
];

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
