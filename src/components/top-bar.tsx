"use client";

import { Building2, Camera, ChevronDown, HelpCircle, Bell, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

type Facility = { id: string; name: string; licenseNumber: string };

/** The facility menu: switching happens as soon as one is picked (the button stays for keyboards and no-JS). */
export function FacilitySwitcher({ facilities, current, action }: { facilities: Facility[]; current: string; action: (formData: FormData) => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
      <label htmlFor="facilityId" className="sr-only">
        Facility
      </label>
      <span className="relative flex min-w-0 flex-1 items-center md:flex-none">
        <Building2 className="pointer-events-none absolute left-3 h-4 w-4 text-brand-700" aria-hidden="true" />
        <select
          // Keyed by facility so the menu shows the new one after switching from any page.
          key={current}
          id="facilityId"
          name="facilityId"
          defaultValue={current}
          onChange={() => form.current?.requestSubmit()}
          className="min-h-10 w-full min-w-0 appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-semibold text-slate-800 shadow-sm sm:pr-9 sm:text-sm hover:border-brand-400 md:w-auto md:min-w-72 md:max-w-md"
        >
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} · {f.licenseNumber}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500" aria-hidden="true" />
      </span>
      <button type="submit" className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-brand-400">
        Switch
      </button>
    </form>
  );
}

/** Search box, bell, help, and the account menu on the right of the top bar. */
export function TopBarRight({
  name,
  roleName,
  alerts,
  signOutAction,
}: {
  name: string;
  roleName: string;
  alerts: number;
  signOutAction: () => Promise<void>;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  // The account menu closes on a click anywhere else on the page (or Escape), not only on its own button.
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = menu.current;
      if (!el?.open) return;
      if (e.type === "click" && (e.target as Node | null) && el.querySelector("summary")?.contains(e.target as Node)) return;
      // After the click has been handled, so a menu link or Sign out still does its job.
      setTimeout(() => {
        el.open = false;
      }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(e);
    };
    document.addEventListener("click", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <form action="/search" role="search" className="relative hidden lg:block">
        <label htmlFor="top-search" className="sr-only">
          Search Leaf2Sale
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          id="top-search"
          name="q"
          type="search"
          placeholder="Search Leaf2Sale…"
          className="min-h-10 w-64 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 hover:border-brand-400 xl:w-80"
        />
      </form>
      {/* Phones only (under 640px): laptops, desktops and tablets are not used to photograph paperwork. A plain link: the camera screen is its own page, and a full load is the fastest way there on a phone. */}
      <a href="/capture" aria-label="Take a photo" title="Take a photo of paperwork" data-testid="camera-link" className="rounded-lg p-2 text-brand-700 hover:bg-brand-50 sm:hidden">
        <Camera className="h-5 w-5" aria-hidden="true" />
      </a>
      <Link href="/search" aria-label="Search" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
        <Search className="h-5 w-5" aria-hidden="true" />
      </Link>
      <Link
        href="/watch"
        aria-label={alerts ? `Tally Watch: ${alerts} to look at` : "Tally Watch: all clear"}
        data-testid="top-alerts"
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {alerts ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {alerts > 99 ? "99+" : alerts}
          </span>
        ) : (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
        )}
      </Link>
      <Link href="/walkthroughs" aria-label="Help and walkthroughs" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">
        <HelpCircle className="h-5 w-5" aria-hidden="true" />
      </Link>
      <details ref={menu} className="relative">
        <summary
          aria-label="Your account"
          className="flex cursor-pointer list-none items-center gap-1 rounded-lg p-1 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-800">{initials || "?"}</span>
          <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-3 pt-1 text-sm font-bold text-slate-900">{name}</p>
          <p className="px-3 pb-2 text-xs text-slate-500">{roleName}</p>
          <Link href="/account" className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Account and security
          </Link>
          <Link href="/inbox" className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Phone inbox
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100">
              Sign out
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
