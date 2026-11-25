import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PAGES.map((p) => ({ url: `${SITE_URL}${p.path === "/" ? "" : p.path}`, lastModified, changeFrequency: p.changeFrequency, priority: p.priority }));
}
