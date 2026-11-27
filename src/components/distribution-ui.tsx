import Decimal from "decimal.js";
import Link from "next/link";

const TABS = [
  { href: "/distribution", label: "Orders" },
  { href: "/distribution/invoices", label: "Invoices" },
  { href: "/distribution/customers", label: "Vendors" },
  { href: "/distribution/prices", label: "Price lists" },
  { href: "/distribution/fleet", label: "Drivers and vehicles" },
];

export function DistributionTabs({ current }: { current: string }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1 rounded-xl border border-brand-100 bg-white p-1.5 shadow-sm print:hidden">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`inline-flex min-h-10 items-center rounded-lg px-3 sm:px-4 text-sm font-bold transition-colors ${
            tab.href === current ? "bg-brand-600 text-white shadow-sm" : "text-brand-800 hover:bg-brand-50"
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
  COMPLETED: "bg-emerald-100 text-emerald-800",
  VOIDED: "bg-red-100 text-red-800",
  OPEN: "bg-amber-100 text-amber-800",
  PARTIAL: "bg-sky-100 text-sky-800",
  PAID: "bg-emerald-100 text-emerald-800",
  OVERDUE: "bg-red-100 text-red-800",
  SENT: "bg-amber-100 text-amber-800",
  RECEIVED: "bg-emerald-100 text-emerald-800",
};

export function Pill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ORDER_STYLES[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.toLowerCase()}
    </span>
  );
}

const ORDER_STEPS = [
  ["DRAFT", "Draft"],
  ["CONFIRMED", "Confirmed"],
  ["PACKED", "Packed"],
  ["SHIPPED", "Shipped"],
  ["DELIVERED", "Delivered"],
] as const;

/** Where an order is in its life, with what to do next underneath. */
export function OrderProgress({ status, next }: { status: string; next: string }) {
  const at = ORDER_STEPS.findIndex(([s]) => s === status);
  const cancelled = status === "CANCELLED";
  return (
    <div className="mb-5 rounded-xl border border-brand-100 bg-white px-4 py-4 shadow-sm sm:px-5" data-testid="order-progress">
      <ol className="flex items-center gap-1 sm:gap-2" aria-label="Order progress">
        {ORDER_STEPS.map(([key, label], i) => {
          const done = !cancelled && i < at;
          const current = !cancelled && i === at;
          return (
            <li key={key} className={`flex min-w-0 items-center gap-1 sm:gap-2 ${current ? "flex-[3] xl:flex-1" : "flex-1"}`} aria-current={current ? "step" : undefined}>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done ? "bg-brand-600 text-white" : current ? "bg-brand-950 text-white ring-4 ring-brand-100" : "bg-slate-100 text-slate-500"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={`truncate text-xs font-semibold sm:text-sm ${current ? "shrink-0 text-brand-950" : `max-xl:sr-only ${done ? "text-brand-700" : "text-slate-500"}`}`}
              >
                {label}
              </span>
              {i < ORDER_STEPS.length - 1 ? <span className={`h-0.5 min-w-2 flex-1 rounded ${done ? "bg-brand-500" : "bg-slate-200"}`} aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
      <p className={`mt-3 text-sm font-medium ${cancelled ? "text-red-800" : "text-slate-800"}`}>
        {cancelled ? <span className="mr-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold uppercase text-red-800">Cancelled</span> : null}
        {next}
      </p>
    </div>
  );
}

/** A thin bar for picked-of-ordered. */
export function PickBar({ picked, of }: { picked: number; of: number }) {
  const pct = of > 0 ? Math.min(100, Math.round((picked / of) * 100)) : 0;
  return (
    <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <span className={`block h-full rounded-full ${pct >= 100 ? "bg-brand-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Five dots for an order's progress, for lists. */
export function MiniProgress({ status }: { status: string }) {
  const at = ORDER_STEPS.findIndex(([s]) => s === status);
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {ORDER_STEPS.map(([key], i) => (
        <span key={key} className={`h-1.5 w-4 rounded-full ${status === "CANCELLED" ? "bg-slate-200" : i <= at ? "bg-brand-600" : "bg-slate-200"}`} />
      ))}
    </span>
  );
}

/** What an order is waiting on, in a few words. */
export const ORDER_NEXT: Record<string, string> = {
  DRAFT: "Add lines and confirm",
  CONFIRMED: "Ready to pick",
  PACKED: "Ready to ship",
  SHIPPED: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};
