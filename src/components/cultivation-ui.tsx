import Link from "next/link";
import { inputBase, inputClass } from "./ui";

const TABS = [
  { href: "/cultivation", label: "Overview" },
  { href: "/cultivation/plants", label: "Plants" },
  { href: "/cultivation/harvests", label: "Harvests" },
  { href: "/cultivation/strains", label: "Strains" },
];

export function CultivationTabs({ current }: { current: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-brand-100 bg-white p-1.5 shadow-sm [scrollbar-width:none]">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-lg px-4 text-sm font-bold transition-colors ${
            tab.href === current ? "bg-brand-600 text-white shadow-sm" : "text-brand-800 hover:bg-brand-50"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** A weight box with a unit picker beside it. */
export function WeightInput({ name, unitName, required }: { name: string; unitName: string; required?: boolean }) {
  return (
    <span className="flex gap-2">
      <input name={name} inputMode="decimal" required={required} className={inputClass} />
      <select name={unitName} defaultValue="G" aria-label="Weight unit" className={`${inputBase} w-24 shrink-0`}>
        <option value="G">g</option>
        <option value="KG">kg</option>
        <option value="LB">lb</option>
        <option value="OZ">oz</option>
      </select>
    </span>
  );
}

export function grams(value: string | null): string {
  if (value === null) return "not recorded";
  const n = Number(value);
  return n >= 1000 ? `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} kg` : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} g`;
}

export function daysSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}
