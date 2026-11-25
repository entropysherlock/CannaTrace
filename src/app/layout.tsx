import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND.name} · Cannabis Seed-to-Sale Software`, template: `%s` },
  description: "Seed-to-sale inventory and compliance for licensed cannabis operators.",
  applicationName: BRAND.name,
  openGraph: { type: "website", siteName: BRAND.name, locale: "en_US", url: SITE_URL },
  twitter: { card: "summary_large_image" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d6a35" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
