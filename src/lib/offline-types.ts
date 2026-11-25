/** Shapes shared by the server and the offline register. Nothing here may import server-only code. */

export type OfflineLimits = { FLOWER: string; CONCENTRATE: string; EDIBLE: string; combined: string | null };

export type OfflineMenuItem = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  unitLabel: string;
  price: string;
  limitCategory: "NONE" | "FLOWER" | "CONCENTRATE" | "EDIBLE";
  limitPerUnit: string | null;
  /** What the register could sell when this copy was saved. */
  stock: string;
};

/** A copy of what the register needs to sell for cash with no internet, saved on the device while it is online. */
export type OfflineSnapshot = {
  version: 1;
  savedAt: string;
  facilityId: string;
  facilityName: string;
  timeZone: string;
  userId: string;
  userName: string;
  /** The seller's open drawer when this was saved, if any. */
  drawerId: string | null;
  settings: { exciseTaxPercent: string; salesTaxPercent: string; medicalTaxExempt: boolean; adultMinAge: number; medicalMinAge: number; dailyLimits: boolean };
  limits: { ADULT_USE: OfflineLimits; MEDICAL: OfflineLimits };
  stateName: string | null;
  menu: OfflineMenuItem[];
  discounts: { id: string; name: string; percent: string }[];
  receiptWarning: string | null;
};

/** One cash sale rung up with no internet, waiting to be sent. */
export type OfflineSale = {
  /** Made on the device; sending the same one twice never records it twice. */
  offlineId: string;
  /** Shown on the offline receipt until the real sale number exists. */
  localNumber: string;
  facilityId: string;
  sellerId: string;
  sellerName: string;
  drawerId: string | null;
  soldAt: string;
  customerType: "ADULT_USE" | "MEDICAL";
  birthDate: string;
  idExpires: string;
  lines: { itemId: string; name: string; quantity: string; unitPrice: string; limitCategory?: "NONE" | "FLOWER" | "CONCENTRATE" | "EDIBLE"; limitPerUnit?: string | null }[];
  discount: { name: string; percent: string } | null;
  /** The tax rates the customer was charged at. Older queued sales have none. */
  rates?: { exciseTaxPercent: string; salesTaxPercent: string; medicalTaxExempt: boolean };
  total: string;
  cashTendered: string;
  changeDue: string;
};

export type OfflineSyncResult = { saleId: string; number: string; flagged: boolean; duplicate: boolean };
