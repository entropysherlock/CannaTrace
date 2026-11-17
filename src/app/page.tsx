import {
  BadgeCheck,
  Boxes,
  Check,
  ClipboardCheck,
  Factory,
  FileLock2,
  KeyRound,
  Leaf,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Sprout,
  Store,
  Truck,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { PACKS } from "@/lib/rules";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "CannaTrace · Seed-to-sale software for licensed cannabis businesses",
  description: "Cultivation, inventory, manufacturing, distribution, retail, and state compliance in one system, with an assistant that answers from your own data.",
};

// Reads the sign-in cookie, so the buttons can say "Go to dashboard" for people already signed in.
export const instant = false;

const display = "font-[family-name:var(--font-display)]";

/* ---------- Product illustrations, drawn from the real screens. Figures are examples. ---------- */

function MiniTile({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-brand-100 bg-white p-3 sm:p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 sm:h-11 sm:w-11">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-extrabold tracking-tight text-brand-950 sm:text-2xl">{value}</span>
        <span className="block truncate text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</span>
      </span>
    </div>
  );
}

function DashboardShowcase() {
  const line = "M0,150 C60,140 110,128 170,120 C240,110 290,104 350,88 C420,70 470,74 540,52 C600,34 650,30 720,12";
  const nav = ["Dashboard", "Cultivation", "Inventory", "Manufacturing", "Distribution", "Register", "Reports", "Compliance"];
  return (
    <figure>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_40px_80px_-20px_rgba(12,48,32,0.45)] ring-1 ring-black/5">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <span className="h-3 w-3 rounded-full bg-slate-300" />
          <span className="h-3 w-3 rounded-full bg-slate-300" />
          <span className="h-3 w-3 rounded-full bg-slate-300" />
          <span className="ml-3 hidden rounded-md bg-white px-3 py-1 text-xs text-slate-500 ring-1 ring-slate-200 sm:block">your-business.cannatrace.app/dashboard</span>
        </div>
        <div className="flex">
          <div className="hidden w-48 shrink-0 flex-col gap-1 bg-brand-950 p-4 md:flex">
            <span className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <Leaf className="h-4 w-4 text-brand-200" aria-hidden="true" /> CannaTrace
            </span>
            {nav.map((label, i) => (
              <span key={label} className={`rounded-lg px-3 py-2 text-xs font-medium ${i === 0 ? "bg-brand-600 text-white" : "text-brand-100"}`}>
                {label}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 bg-[#e8f1eb] p-3 sm:p-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2 sm:mb-4">
              <div>
                <p className="text-lg font-extrabold text-brand-950 sm:text-2xl">Dashboard</p>
                <p className="text-[11px] text-slate-600 sm:text-xs">Front Street Grow · license NM-0000</p>
              </div>
              <div className="hidden gap-2 sm:flex">
                {["New sale", "Receive", "Count"].map((b) => (
                  <span key={b} className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-800">
                    {b}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <MiniTile icon={Sprout} value="1,240" label="Plants growing" />
              <MiniTile icon={Boxes} value="386" label="Packages in stock" />
              <MiniTile icon={ShoppingCart} value="$48,900" label="Sales, last 30 days" />
              <MiniTile icon={ShieldCheck} value="96" label="Compliance score" />
            </div>
            <div className="mt-2 grid gap-2 sm:mt-3 sm:gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-brand-100 bg-white p-3 sm:p-4 lg:col-span-2">
                <p className="text-xs font-bold text-brand-900 sm:text-sm">Sales by day</p>
                <svg viewBox="0 0 720 160" className="mt-2 h-28 w-full sm:h-40" aria-hidden="true">
                  <defs>
                    <linearGradient id="hero-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#2f8a4c" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#2f8a4c" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[40, 80, 120].map((y) => (
                    <line key={y} x1="0" x2="720" y1={y} y2={y} stroke="#e2e8f0" />
                  ))}
                  <path d={`${line} L720,160 L0,160 Z`} fill="url(#hero-area)" />
                  <path d={line} fill="none" stroke="#237a3e" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
              <div className="rounded-xl border border-brand-100 bg-white p-3 sm:p-4">
                <p className="text-xs font-bold text-brand-900 sm:text-sm">Needs attention</p>
                <ul className="mt-2 space-y-2 text-[11px] sm:text-xs">
                  <li className="flex items-center gap-2 text-slate-700">
                    <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" /> 2 packages need a lab result
                  </li>
                  <li className="flex items-center gap-2 text-slate-700">
                    <ClipboardCheck className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" /> Monthly count done
                  </li>
                  <li className="flex items-center gap-2 text-slate-700">
                    <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" /> State reports up to date
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-slate-500">Example screen. Figures are for illustration.</figcaption>
    </figure>
  );
}

function RulesVignette() {
  const rows = [
    ["Adult-use purchase limit", "Enforced at the register"],
    ["Lab testing before sale", "Enforced at the register"],
    ["Waste: 72-hour hold, 50% mix", "Enforced when destroying"],
    ["Monthly inventory count", "Checked daily"],
  ];
  return (
    <div className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-brand-50 pb-4">
        <div>
          <p className="text-sm font-semibold text-slate-600">Compliance score</p>
          <p className={`${display} text-5xl font-bold text-brand-700`}>
            96<span className="text-xl text-slate-400">/100</span>
          </p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800">New Mexico rules</span>
      </div>
      <ul className="mt-3 divide-y divide-brand-50">
        {rows.map(([rule, how]) => (
          <li key={rule} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-slate-800">
              <Check className="h-4 w-4 text-brand-600" aria-hidden="true" />
              {rule}
            </span>
            <span className="hidden text-xs font-semibold text-brand-700 sm:inline">{how}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssistantVignette() {
  return (
    <div className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-sm text-white">Put package 0042 on hold, we&apos;re waiting on the retest.</p>
      <div className="mt-4 flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-700">Ready. Review it and press Confirm.</p>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">Hold package</p>
            <dl className="space-y-1.5 px-4 py-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Package</dt>
                <dd className="font-medium text-slate-900">0042 · Blue Mesa 3.5 g</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium text-slate-900">Active → On hold</dd>
              </div>
            </dl>
            <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
              <span className="flex-1 rounded-lg bg-brand-700 py-2 text-center text-sm font-semibold text-white">Confirm</span>
              <span className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RegisterVignette() {
  return (
    <div className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-brand-50 pb-3">
        <p className="font-bold text-brand-950">Cart S-00418</p>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800">Adult-use · ID checked</span>
      </div>
      <ul className="divide-y divide-brand-50 text-sm">
        {[
          ["Blue Mesa 3.5 g jar", "x8", "$280.00"],
          ["Prickly Pear gummies", "x2", "$44.00"],
        ].map(([item, q, price]) => (
          <li key={item} className="flex justify-between gap-3 py-2.5">
            <span className="text-slate-800">
              {item} <span className="text-slate-400">{q}</span>
            </span>
            <span className="font-semibold text-slate-900">{price}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Adding one more jar puts the cart at 31.5 g of flower. California law allows 28.5 g per day.
      </p>
    </div>
  );
}

/* ---------- Page ---------- */

const MODULES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Sprout, title: "Cultivation", text: "Batches, plant tags, phase moves, harvest weights, and waste, from clone to cure." },
  { icon: Boxes, title: "Inventory", text: "Every package by tag, lot, and location, with splits, merges, holds, and counts." },
  { icon: Factory, title: "Manufacturing", text: "Recipes, production runs, yield against plan, and cost per unit." },
  { icon: Truck, title: "Distribution", text: "Licensed customers, price lists, manifests, invoices, and payments." },
  { icon: Store, title: "Retail", text: "ID check, state purchase limits, taxes, cash drawer, and receipts." },
  { icon: ScrollText, title: "Reports and audit", text: "Sales, stock, and an audit trail of every change that cannot be edited." },
];

const STEPS = [
  { title: "Create your business", text: "Enter your business, your first license, and your own login. It takes about two minutes." },
  { title: "Invite your team", text: "Send each person a one-time link with the role you choose, or build your own role." },
  { title: "Start tracking", text: "Receive packages, tag plants, or open the register. Your state's rules are applied from the first sale." },
];

const TRUST: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Users, title: "Roles for every job", text: "Seven built-in roles plus ones you build, down to single permissions." },
  { icon: ScrollText, title: "Records that can't be rewritten", text: "Inventory history and the audit trail are append-only in the database." },
  { icon: KeyRound, title: "Passwords and keys stay secret", text: "Passwords are hashed. API keys and invite links are stored only as hashes." },
  { icon: FileLock2, title: "Changes you approve", text: "The assistant only proposes changes. Nothing happens until a person confirms." },
];

const FAQ = [
  ["Which states does CannaTrace support?", `Rule packs today cover ${Object.values(PACKS).map((p) => p.name).join(", ")}. Every rule links to the regulation it comes from. Businesses in other states can still use everything else, with their own limits.`],
  ["Does it connect to Metrc or my state's tracking system?", "CannaTrace keeps a reporting queue of every change and sends it to the state system as connections become available. Until then, it lists exactly what to enter by hand, so nothing is missed."],
  ["What does the assistant do?", "It answers questions from your live data, like what's on hold or who owes you money, and can prepare changes such as moving or holding a package. You review and confirm every change."],
  ["Can I bring my existing inventory?", "Yes. Import packages, items, and customers from a spreadsheet. Every row is checked first, and nothing is imported until the whole file is clean."],
  ["Does it work on phones and tablets?", "Yes. Every screen works on a phone, and the camera can scan package tags."],
];

export default async function HomePage() {
  const signedIn = Boolean(await getSession());
  const cta = signedIn ? { href: "/dashboard", label: "Go to dashboard" } : { href: "/signup", label: "Get started" };

  return (
    <div className="bg-white text-slate-900">
      {/* Hero */}
      <div className="bg-brand-950 text-white">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-brand-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
            <Link href="/" aria-label="CannaTrace home">
              <Logo tone="light" />
            </Link>
            <nav className="hidden items-center gap-8 text-sm font-medium text-brand-100 lg:flex">
              <a href="#platform" className="hover:text-white">
                Platform
              </a>
              <a href="#compliance" className="hover:text-white">
                Compliance
              </a>
              <a href="#assistant" className="hover:text-white">
                Assistant
              </a>
              <a href="#faq" className="hover:text-white">
                Questions
              </a>
            </nav>
            <div className="flex items-center gap-2">
              {signedIn ? null : (
                <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-100 hover:text-white">
                  Sign in
                </Link>
              )}
              <Link href={cta.href} className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-brand-950 hover:bg-brand-50">
                {cta.label}
              </Link>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-7xl px-5 pb-0 pt-16 sm:pt-24">
          <div className="max-w-3xl">
            <h1 className={`${display} text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl`}>From seed to sale, every gram accounted for.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-brand-100 sm:text-xl">
              CannaTrace runs cultivation, inventory, manufacturing, wholesale, and retail for licensed cannabis businesses, and applies your state&apos;s rules at every step.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={cta.href} className="rounded-xl bg-white px-6 py-3.5 text-base font-bold text-brand-950 shadow-sm hover:bg-brand-50">
                {cta.label}
              </Link>
              <a href="#platform" className="rounded-xl px-6 py-3.5 text-base font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
                See the platform
              </a>
            </div>
          </div>
          <div className="relative mt-14 sm:mt-20">
            <div className="relative z-10 -mb-32 sm:-mb-48">
              <DashboardShowcase />
            </div>
          </div>
        </section>
      </div>

      {/* State packs */}
      <section className="bg-white pb-16 pt-44 sm:pt-60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-5 text-center">
          <p className="w-full text-sm font-semibold text-slate-600 sm:w-auto">State rules built in for</p>
          {Object.values(PACKS).map((p) => (
            <span key={p.state} className={`${display} text-2xl font-bold text-brand-900`}>
              {p.name}
            </span>
          ))}
        </div>
      </section>

      {/* Platform */}
      <section id="platform" className="scroll-mt-24 border-t border-brand-50 bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className={`${display} max-w-3xl text-4xl font-bold tracking-tight text-brand-950 sm:text-5xl`}>One system from the grow room to the register.</h2>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">Every module shares the same inventory, so a plant you tag today is the jar you sell next month, with its full history.</p>
          <div className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="border-t-2 border-brand-600 pt-5">
                <Icon className="h-7 w-7 text-brand-700" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold text-brand-950">{title}</h3>
                <p className="mt-1.5 leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature rows */}
      <section id="compliance" className="scroll-mt-24 bg-brand-50 py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2">
          <div>
            <ShieldCheck className="h-9 w-9 text-brand-700" aria-hidden="true" />
            <h2 className={`${display} mt-5 text-4xl font-bold tracking-tight text-brand-950`}>Your state&apos;s rules, enforced where the work happens.</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Purchase limits at the register, lab testing before sale, waste hold periods before destruction. Each rule links to the regulation it comes from, and a daily score shows what to fix before an inspector finds it.
            </p>
            <ul className="mt-6 space-y-2 text-slate-800">
              {["Stricter of your store's limits and the state's", "Untested product can't be rung up", "Score and fix list on the dashboard"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-brand-600" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <RulesVignette />
        </div>
      </section>

      <section id="assistant" className="scroll-mt-24 bg-white py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2">
          <div className="lg:order-2">
            <Sparkles className="h-9 w-9 text-brand-700" aria-hidden="true" />
            <h2 className={`${display} mt-5 text-4xl font-bold tracking-tight text-brand-950`}>Ask your business anything.</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              The built-in assistant answers from your live data: top sellers last week, what&apos;s on hold, which customers owe you. Ask it to move or hold a package and it prepares the change for you to confirm.
            </p>
            <ul className="mt-6 space-y-2 text-slate-800">
              {["Sees only what your role allows", "Every change waits for your Confirm", "Recorded in the audit trail"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-brand-600" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:order-1">
            <AssistantVignette />
          </div>
        </div>
      </section>

      <section className="bg-brand-50 py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2">
          <div>
            <Store className="h-9 w-9 text-brand-700" aria-hidden="true" />
            <h2 className={`${display} mt-5 text-4xl font-bold tracking-tight text-brand-950`}>A register that knows the law.</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Check ID at the door, ring up by scan, and let CannaTrace stop a sale before it goes over the limit. Taxes, discounts, cash drawers, voids, and end-of-day totals are built in.
            </p>
          </div>
          <RegisterVignette />
        </div>
      </section>

      {/* Getting started: a real sequence */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className={`${display} max-w-2xl text-4xl font-bold tracking-tight text-brand-950`}>Up and running the same day.</h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-brand-100 p-6">
                <span className={`${display} flex h-11 w-11 items-center justify-center rounded-full bg-brand-700 text-xl font-bold text-white`}>{i + 1}</span>
                <h3 className="mt-5 text-lg font-bold text-brand-950">{step.title}</h3>
                <p className="mt-1.5 leading-relaxed text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust */}
      <section className="bg-brand-950 py-20 text-white sm:py-24">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className={`${display} max-w-2xl text-4xl font-bold tracking-tight`}>Built for an industry that gets audited.</h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <Icon className="h-7 w-7 text-brand-200" aria-hidden="true" />
                <h3 className="mt-4 font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-brand-100">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-24 bg-white py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-3">
          <h2 className={`${display} text-4xl font-bold tracking-tight text-brand-950`}>Questions operators ask.</h2>
          <div className="divide-y divide-brand-100 border-y border-brand-100 lg:col-span-2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold text-brand-950">
                  {q}
                  <span className="text-2xl font-light text-brand-600 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="bg-brand-50 py-20">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-5 lg:flex-row lg:items-center">
          <div>
            <h2 className={`${display} text-4xl font-bold tracking-tight text-brand-950 sm:text-5xl`}>Run your whole operation in one place.</h2>
            <p className="mt-3 text-lg text-slate-600">Set up your business, add your licenses, and start tracking today.</p>
          </div>
          <Link href={cta.href} className="shrink-0 rounded-xl bg-brand-700 px-8 py-4 text-lg font-bold text-white shadow-sm hover:bg-brand-800">
            {cta.label}
          </Link>
        </div>
      </section>

      <footer className="border-t border-brand-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-slate-500">
          <Logo />
          <nav className="flex flex-wrap gap-6">
            <a href="#platform" className="hover:text-brand-700">
              Platform
            </a>
            <a href="#compliance" className="hover:text-brand-700">
              Compliance
            </a>
            <a href="#faq" className="hover:text-brand-700">
              Questions
            </a>
            <Link href="/login" className="hover:text-brand-700">
              Sign in
            </Link>
          </nav>
          <p className="flex items-center gap-1.5">
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Seed-to-sale software for licensed cannabis businesses
          </p>
        </div>
      </footer>
    </div>
  );
}
