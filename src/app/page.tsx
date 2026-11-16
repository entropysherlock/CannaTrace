import {
  ArrowRight,
  Boxes,
  Building2,
  Check,
  Factory,
  LayoutDashboard,
  MapPin,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Sprout,
  Store,
  Truck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LeafMark, Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "CannaTrace · Seed-to-sale software for cannabis operators",
  description: "Cultivation, inventory, manufacturing, distribution, retail, and state reporting in one system.",
};

const MODULES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Sprout, title: "Cultivation", text: "Batches, tagged plants, growth phases, harvests, and waste, from clone to cure." },
  { icon: Boxes, title: "Inventory", text: "Every package by tag, lot, and location. Split, merge, count, and hold with a reason." },
  { icon: ShieldCheck, title: "Compliance", text: "State reporting queue, lab results, and an audit trail that cannot be edited." },
  { icon: Factory, title: "Manufacturing", text: "Recipes, production runs, yield against plan, and cost per unit." },
  { icon: Truck, title: "Distribution", text: "Licensed customers, price lists, picking, manifests, invoices, and payments." },
  { icon: Store, title: "Retail", text: "Age check, purchase limits, taxes, cash drawer, receipts, and end-of-day report." },
];

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Zap, title: "Real-time inventory", text: "Quantities change only through recorded transactions, so the numbers always add up." },
  { icon: ScrollText, title: "Audit-ready traceability", text: "Who did what, when, and why, on every package from receipt to sale." },
  { icon: Smartphone, title: "Built for the floor", text: "Works on a phone with a barcode scanner or the camera." },
  { icon: MapPin, title: "Multi-location", text: "Run several licenses from one account and switch in one tap." },
];

const AUDIENCE: { icon: LucideIcon; label: string }[] = [
  { icon: Sprout, label: "Growers" },
  { icon: Factory, label: "Producers" },
  { icon: Truck, label: "Distributors" },
  { icon: Store, label: "Retailers" },
];

function PreviewStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-sm font-bold text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}

/** A drawing of the dashboard for the homepage. Its figures are illustrative, and it says so. */
function ProductPreview() {
  const path = "M0,70 C30,66 50,60 80,58 C110,56 130,50 160,44 C190,40 210,30 240,26 C270,22 290,12 320,6";
  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/10">
        <div className="flex">
          <div className="hidden w-32 shrink-0 flex-col gap-1 bg-brand-950 p-3 sm:flex">
            <span className="mb-2 flex items-center gap-1.5 text-xs font-bold text-white">
              <LeafMark className="h-4 w-4 text-brand-200" /> CannaTrace
            </span>
            {["Dashboard", "Cultivation", "Inventory", "Manufacturing", "Distribution", "Retail", "Compliance"].map((label, i) => (
              <span key={label} className={`rounded px-2 py-1 text-[10px] ${i === 0 ? "bg-brand-600 text-white" : "text-brand-100"}`}>
                {label}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-bold text-slate-900">Dashboard</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <PreviewStat value="1,240" label="Plants growing" />
              <PreviewStat value="386" label="Packages in stock" />
              <PreviewStat value="7" label="In production" />
              <PreviewStat value="$48,900" label="Sales, 30 days" />
            </div>
            <div className="mt-2 grid gap-2 lg:grid-cols-5">
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 lg:col-span-3">
                <p className="mb-1 text-[10px] font-semibold text-slate-700">Sales by day</p>
                <svg viewBox="0 0 320 80" className="h-20 w-full" aria-hidden="true">
                  <defs>
                    <linearGradient id="hero-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#2f8a4c" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#2f8a4c" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={`${path} L320,80 L0,80 Z`} fill="url(#hero-fill)" />
                  <path d={path} fill="none" stroke="#237a3e" strokeWidth="2" />
                </svg>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 lg:col-span-2">
                <p className="mb-1 text-[10px] font-semibold text-slate-700">Compliance status</p>
                {["State reporting", "Inventory reconciliation", "Audit trail"].map((row) => (
                  <p key={row} className="flex items-center gap-1 py-0.5 text-[10px] text-slate-700">
                    <Check className="h-3 w-3 text-brand-600" aria-hidden="true" /> {row}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-slate-500">Example view. Figures are for illustration.</figcaption>
    </figure>
  );
}

export default function HomePage() {
  return (
    <div className="bg-white">
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="CannaTrace home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-700 md:flex">
            <a href="#features" className="hover:text-brand-700">
              Features
            </a>
            <a href="#why" className="hover:text-brand-700">
              Why CannaTrace
            </a>
            <a href="#who" className="hover:text-brand-700">
              Who it&apos;s for
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              Sign in
            </Link>
            <Link href="/login" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-gradient-to-br from-brand-50 via-white to-brand-50">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-2 lg:py-20">
          <div>
            <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-900">Cannabis operations software</span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              From Seed to Sale.
              <br />
              <span className="text-brand-700">Fully Tracked.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              CannaTrace helps cannabis operators manage cultivation, inventory, compliance, manufacturing, distribution, and retail in one system.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-800"
              >
                Get started <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-800 hover:bg-slate-50"
              >
                <LayoutDashboard className="h-5 w-5" aria-hidden="true" /> See what&apos;s inside
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
              {["Seed-to-sale tracking", "Audit trail on every change", "Works with scanners", "Built for cannabis"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">A complete cannabis operations platform</h2>
        <p className="mt-2 text-center text-slate-600">Every stage of a licensed cannabis business, connected.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="why" className="scroll-mt-20 bg-brand-50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-3">
              <Icon className="mt-0.5 h-6 w-6 shrink-0 text-brand-700" aria-hidden="true" />
              <div>
                <h3 className="font-semibold text-slate-900">{title}</h3>
                <p className="mt-1 text-sm text-slate-600">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="who" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14">
        <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Who it&apos;s for</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Built for growers, producers,
              <br className="hidden sm:block" /> distributors, and retailers.
            </h2>
          </div>
          <ul className="flex gap-8">
            {AUDIENCE.map(({ icon: Icon, label }) => (
              <li key={label} className="flex flex-col items-center gap-2 text-sm font-medium text-slate-800">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 to-brand-950 px-6 py-12 text-center text-white sm:px-12">
          <LeafMark className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 text-white/5" />
          <Building2 className="mx-auto h-10 w-10 text-brand-200" aria-hidden="true" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Run your whole operation in one place</h2>
          <p className="mx-auto mt-2 max-w-xl text-brand-100">Set up your business, add your licenses, and start tracking today.</p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-brand-900 shadow-sm hover:bg-brand-50"
          >
            Get started <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500">
          <Logo />
          <p>Seed-to-sale software for licensed cannabis operators.</p>
        </div>
      </footer>
    </div>
  );
}
