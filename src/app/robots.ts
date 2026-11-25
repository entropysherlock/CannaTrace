import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/privacy", "/terms", "/new-mexico-cannabis-seed-to-sale-software"],
        disallow: ["/api/", "/dashboard", "/inventory", "/pos", "/settings", "/login", "/signup", "/setup", "/reset", "/invite/", "/link/", "/capture", "/demo", "/export", "/menu/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
