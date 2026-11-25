/** Shared facts for the public legal pages. Change the operator line here when the LLC forms. */
export const LEGAL = {
  /** Who "we" are. Replace with the company's legal name once the LLC exists. */
  operator: "Leaf2Sale, operated by Caleb J. Westfall",
  place: "Albuquerque, New Mexico, USA",
  effective: "November 22, 2026",
  /** Shown on every legal page until a lawyer has reviewed it. */
  draftNotice: "This is a plain-language draft that has not yet been reviewed by an attorney. It may change before we sign up our first paying business.",
  /** Outside services that touch stored data. Kept in one place so the Privacy Policy and Data Agreement match. */
  providers: [
    { name: "Vercel", does: "hosts the app and serves the website" },
    { name: "Neon", does: "stores the database (all business records)" },
    { name: "GitHub", does: "keeps our code and our encrypted nightly database backups" },
    { name: "Sentry", does: "receives crash reports with no personal or business data (error, stack and page path only)" },
    { name: "Anthropic", does: "answers Tally questions, only when a business has connected its own Claude account" },
  ],
} as const;

export type LegalSection = { heading: string; paragraphs?: string[]; items?: string[] };
