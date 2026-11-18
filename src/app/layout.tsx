import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CannaTrace",
  description: "Seed-to-sale inventory and compliance for licensed cannabis operators.",
};

// viewport-fit=cover lets fixed controls use the safe-area insets on phones with a notch or home bar.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
