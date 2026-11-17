"use client";

import {
  LifeBuoy,
  BarChart3,
  Tag,
  Boxes,
  Factory,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  Sprout,
  Store,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  cultivation: Sprout,
  inventory: Boxes,
  manufacturing: Factory,
  distribution: Truck,
  register: Store,
  labels: Tag,
  reports: BarChart3,
  compliance: ShieldCheck,
  settings: Settings,
  support: LifeBuoy,
};

export type Tab = { href: string; label: string };
/** One sidebar entry. When it has tabs, it opens the first tab and stays lit on any of them. */
export type NavItem = { key: string; label: string; href: string; tabs?: Tab[] };
export type NavGroup = { heading?: string; items: NavItem[] };

const matches = (href: string, pathname: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The most specific link that matches the current page. */
function best<T extends { href: string }>(links: T[], pathname: string): T | null {
  return links.filter((l) => matches(l.href, pathname)).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

function activeItem(groups: NavGroup[], pathname: string): NavItem | null {
  const all = groups.flatMap((g) => g.items);
  const candidates = all.flatMap((item) => [item, ...(item.tabs ?? [])].map((link) => ({ href: link.href, item })));
  return best(candidates, pathname)?.item ?? null;
}

function NavLink({ item, on, onClick }: { item: NavItem; on: boolean; onClick?: () => void }) {
  const Icon = ICONS[item.key] ?? LayoutDashboard;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        on ? "bg-brand-600 text-white shadow-sm" : "text-brand-100 hover:bg-brand-900 hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const active = activeItem(groups, pathname);
  return (
    <nav className="flex flex-col gap-5" aria-label="Main">
      {groups.map((group, i) => (
        <div key={group.heading ?? i} className="flex flex-col gap-0.5">
          {group.heading ? <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-200/70">{group.heading}</p> : null}
          {group.items.map((item) => (
            <NavLink key={item.key} item={item} on={item.key === active?.key} />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Tabs across the top of pages that share one sidebar entry, such as Inventory's Packages, Receive, and Counts. */
export function SectionTabs({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const item = activeItem(groups, pathname);
  if (!item?.tabs || item.tabs.length < 2) return null;
  const current = best(item.tabs, pathname);
  return (
    <nav
      aria-label={`${item.label} sections`}
      className="-mt-1 mb-6 overflow-x-auto overflow-y-hidden rounded-xl border border-brand-100 bg-white p-1.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex min-w-max gap-1">
        {item.tabs.map((tab) => {
          const on = tab.href === current?.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-bold transition-colors ${
                  on ? "bg-brand-600 text-white shadow-sm" : "text-brand-800 hover:bg-brand-50"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phones: the four most used places, plus Menu for everything else. */
export function BottomNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = activeItem(groups, pathname);
  const all = groups.flatMap((g) => g.items);
  const quick = all.slice(0, 4);

  return (
    <>
      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white md:hidden print:hidden">
        {quick.map((item) => {
          const Icon = ICONS[item.key] ?? LayoutDashboard;
          const on = item.key === active?.key && !open;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? "text-brand-700" : "text-slate-600"}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${open || (active && !quick.includes(active)) ? "text-brand-700" : "text-slate-600"}`}
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          Menu
        </button>
      </nav>
      {open ? (
        <div
          className="fixed inset-x-0 bottom-14 top-0 z-10 overflow-y-auto bg-brand-950 p-4 md:hidden"
          role="dialog"
          aria-label="Menu"
          // Close once a link is chosen.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <SideNav groups={groups} />
        </div>
      ) : null}
    </>
  );
}
