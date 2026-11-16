import Link from "next/link";

const TABS = [
  { href: "/manufacturing", label: "Production runs" },
  { href: "/manufacturing/recipes", label: "Recipes" },
];

export function ManufacturingTabs({ current }: { current: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`min-h-11 shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
            tab.href === current ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
