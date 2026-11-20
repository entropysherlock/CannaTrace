import Link from "next/link";

export function PosTabs({ current, canManage, pickups = 0, review = 0 }: { current: string; canManage: boolean; pickups?: number; review?: number }) {
  const tabs = [
    { href: "/pos", label: "Register" },
    { href: "/pos/pickups", label: pickups > 0 ? `Pickups (${pickups})` : "Pickups" },
    { href: "/pos/drawer", label: "Cash drawer" },
    ...(canManage ? [{ href: "/pos/review", label: review > 0 ? `To review (${review})` : "To review" }] : []),
    ...(canManage ? [{ href: "/pos/menu", label: "Menu and store rules" }] : []),
  ];
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-brand-100 bg-white p-1.5 shadow-sm [scrollbar-width:none] print:hidden">
      {tabs.map((tab) => (
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
