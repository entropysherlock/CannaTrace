"use client";

import { Building2, CalendarDays } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

/** Which facilities and how many days the Command Center covers. Changing either reloads the numbers. */
export function DashboardFilters({ scope, days, facilityName, facilityCount }: { scope: "one" | "all"; days: number; facilityName: string; facilityCount: number }) {
  const router = useRouter();
  const path = usePathname();
  const go = (next: { scope?: string; days?: string }) => {
    const p = new URLSearchParams();
    const s = next.scope ?? scope;
    const d = next.days ?? String(days);
    if (s === "all") p.set("scope", "all");
    if (d !== "30") p.set("days", d);
    router.push(`${path}${p.size ? `?${p}` : ""}`);
  };
  const select = "min-h-10 appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-sm font-semibold text-slate-800 shadow-sm hover:border-brand-400";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {facilityCount > 1 ? (
        <label className="relative flex items-center">
          <span className="sr-only">Facilities shown</span>
          <Building2 className="pointer-events-none absolute left-3 h-4 w-4 text-brand-700" aria-hidden="true" />
          <select value={scope} onChange={(e) => go({ scope: e.target.value })} className={select} data-testid="dash-scope">
            <option value="one">{facilityName}</option>
            <option value="all">All facilities ({facilityCount})</option>
          </select>
        </label>
      ) : null}
      <label className="relative flex items-center">
        <span className="sr-only">Period</span>
        <CalendarDays className="pointer-events-none absolute left-3 h-4 w-4 text-brand-700" aria-hidden="true" />
        <select value={String(days)} onChange={(e) => go({ days: e.target.value })} className={select} data-testid="dash-days">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </label>
    </div>
  );
}
