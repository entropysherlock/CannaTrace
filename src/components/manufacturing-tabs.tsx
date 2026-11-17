import Link from "next/link";

const TABS = [
  { href: "/manufacturing", label: "Production runs" },
  { href: "/manufacturing/recipes", label: "Recipes" },
];

export function ManufacturingTabs({ current }: { current: string }) {
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
