import Decimal from "decimal.js";
import Link from "next/link";

const TABS = [
  { href: "/distribution", label: "Orders" },
  { href: "/distribution/invoices", label: "Invoices" },
  { href: "/distribution/customers", label: "Customers" },
  { href: "/distribution/prices", label: "Price lists" },
  { href: "/distribution/fleet", label: "Drivers and vehicles" },
];

export function DistributionTabs({ current }: { current: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 print:hidden">
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

export const usd = (value: Decimal.Value) =>
  `$${new Decimal(value).toNumber().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Unit prices can have up to four decimals; show at least two. */
export const unitPrice = (value: Decimal.Value) => {
  const d = new Decimal(value);
  return `$${d.decimalPlaces() > 2 ? d.toString() : d.toFixed(2)}`;
};

const ORDER_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-200 text-slate-700",
  CONFIRMED: "bg-amber-100 text-amber-800",
  PACKED: "bg-sky-100 text-sky-800",
  SHIPPED: "bg-fuchsia-100 text-fuchsia-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-800 text-white",
  OPEN: "bg-amber-100 text-amber-800",
  PARTIAL: "bg-sky-100 text-sky-800",
  PAID: "bg-emerald-100 text-emerald-800",
  OVERDUE: "bg-red-100 text-red-800",
};

export function Pill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ORDER_STYLES[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.toLowerCase()}
    </span>
  );
}
