import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: BRAND.name,
  description: "Seed-to-sale inventory and compliance for licensed cannabis operators.",
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
