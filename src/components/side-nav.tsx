"use client";

import {
  ArrowDownToLine,
  BarChart3,
  Boxes,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  LayoutDashboard,
  MapPin,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Sprout,
  Store,
  Tag,
  Truck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/inventory": Boxes,
  "/inventory/receive": ArrowDownToLine,
  "/cultivation": Sprout,
  "/manufacturing": Factory,
  "/distribution": Truck,
  "/pos": Store,
  "/counts": ClipboardList,
  "/catalog": Tag,
  "/locations": MapPin,
  "/reports": BarChart3,
  "/data": FileSpreadsheet,
  "/compliance": ShieldCheck,
  "/audit": ScrollText,
  "/integrations": Plug,
  "/settings": Settings,
};

type Item = { href: string; label: string };

/** The most specific nav entry that matches the current page is the active one. */
function activeHref(items: Item[], pathname: string): string | null {
  const matches = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

export function SideNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const active = activeHref(items, pathname);
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        const on = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              on ? "bg-brand-600 text-white shadow-sm" : "text-brand-100 hover:bg-brand-900 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const active = activeHref(items, pathname);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex overflow-x-auto border-t border-slate-200 bg-white md:hidden print:hidden">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        const on = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-14 shrink-0 grow basis-20 flex-col items-center justify-center gap-0.5 px-1 text-center text-[11px] font-semibold ${
              on ? "text-brand-700" : "text-slate-600"
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
