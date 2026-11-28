import Decimal from "decimal.js";
import { gt } from "drizzle-orm";
import { retailPrices } from "@/db/schema";

/**
 * A menu row saved with this price is on the menu but waiting for a manager to price it ("Needs a price").
 * Real shelf prices are always more than zero, so zero can never be mistaken for one.
 */
export const NEEDS_PRICE = "0";

/** True when a stored menu price is a real shelf price the register may sell at. */
export function isPriced(price: Decimal.Value | null | undefined): boolean {
  return price !== null && price !== undefined && new Decimal(price).gt(0);
}

/** Query filter: only menu rows that have a real shelf price. */
export const pricedOnly = () => gt(retailPrices.price, NEEDS_PRICE);
