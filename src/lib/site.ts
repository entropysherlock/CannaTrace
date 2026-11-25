/** The public address of the site, used for canonical links, the sitemap, and search-engine data. */
export const SITE_URL = "https://leaf2sale.com";

/** Public pages that search engines should list. The sign-in, sign-up, and app pages are left out on purpose. */
export const PUBLIC_PAGES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/new-mexico-cannabis-seed-to-sale-software", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
];
