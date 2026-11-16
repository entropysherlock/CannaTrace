import Link from "next/link";

export function PosTabs({ current, canManage }: { current: string; canManage: boolean }) {
  const tabs = [
    { href: "/pos", label: "Register" },
    { href: "/pos/drawer", label: "Cash drawer" },
    ...(canManage ? [{ href: "/pos/menu", label: "Menu and store rules" }] : []),
  ];
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 print:hidden">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`min-h-11 shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
            tab.href === current ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
