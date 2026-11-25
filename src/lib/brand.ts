/**
 * The product's name and logo files, in one place. Change the name here and in public/brand to rebrand
 * the app's titles, manifest, header logo, and wording that reads from BRAND.
 * Not renamed on purpose (changing them would break stored data or integrations): the encryption labels
 * in lib/ai/secret-box.ts, browser storage keys, the webhook header names, and the database and backup names.
 */
export const BRAND = {
  name: "Leaf2Sale",
  /** Horizontal logo for light backgrounds (transparent, dark text). */
  logo: { src: "/brand/leaf2sale-logo.png", width: 900, height: 246 },
  /** Horizontal logo for dark backgrounds (transparent, white text). */
  logoDark: { src: "/brand/leaf2sale-logo-dark.png", width: 900, height: 235 },
} as const;
