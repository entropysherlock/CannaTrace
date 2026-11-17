import {
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Factory,
  Leaf,
  MapPin,
  Play,
  ShieldCheck,
  Sprout,
  Store,
  Truck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LeafMark, Logo } from "@/components/logo";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "CannaTrace · Seed-to-Sale Operations Platform",
  description: "CannaTrace helps cannabis operators manage cultivation, inventory, compliance, manufacturing, distribution, and retail operations in one integrated platform.",
};

const CONTACT_EMAILS = ["calebwestfall1989@gmail.com", "ccwestfall85@gmail.com"];
const mailto = (subject: string) => `mailto:${CONTACT_EMAILS.join(",")}?subject=${encodeURIComponent(subject)}`;
const DEMO_LINK = mailto("CannaTrace demo request");
const PRICING_LINK = mailto("CannaTrace pricing question");

// Reads the sign-in cookie, so the buttons can say "Go to dashboard" for people already signed in.
export const instant = false;

/* ---------- The example dashboard in the hero. Figures are for illustration. ---------- */

function Stat({ icon: Icon, value, label, change }: { icon: LucideIcon; value: string; label: string; change: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <Icon className="h-7 w-7 shrink-0 text-brand-600" aria-hidden="true" />
      <div className="min-w-0">
        <p className="whitespace-nowrap text-base font-extrabold leading-tight text-slate-900">{value}</p>
        <p className="whitespace-nowrap text-[11px] text-slate-500">{label}</p>
        <p className="whitespace-nowrap text-[11px] font-semibold text-brand-600">↑ {change}</p>
      </div>
    </div>
  );
}

function HeroDashboard() {
  const series = [
    { d: "M0,120 C40,112 80,100 120,96 C160,92 200,84 240,72 C280,60 320,50 360,30 C380,22 400,12 420,4", w: 3, o: 1 },
    { d: "M0,130 C40,126 80,118 120,116 C160,112 200,106 240,98 C280,90 320,82 360,70 C380,64 400,58 420,52", w: 2, o: 0.55 },
    { d: "M0,138 C40,136 80,132 120,130 C160,128 200,124 240,120 C280,114 320,108 360,100 C380,96 400,92 420,88", w: 2, o: 0.3 },
  ];
  const nav = ["Dashboard", "Cultivation", "Inventory", "Manufacturing", "Distribution", "Retail", "Compliance", "Reports"];
  const checks = [
    ["State Reporting", "Up to date"],
    ["Metrc Integration", "Connected"],
    ["Inventory Reconciliation", "No issues"],
    ["Audit Readiness", "Ready"],
  ];
  const stages = ["Cultivate", "Harvest", "Manufacture", "Package", "Distribute", "Retail"];
  return (
    <figure>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_60px_-20px_rgba(12,48,32,0.35)]">
        <div className="flex">
          <div className="hidden w-36 shrink-0 bg-brand-950 p-3 sm:block">
            <p className="mb-5 mt-1 flex items-center gap-1.5 text-sm font-bold text-white">
              <LeafMark className="h-5 w-5 text-brand-200" /> CannaTrace
            </p>
            {nav.map((label, i) => (
              <p key={label} className={`mb-0.5 rounded-lg px-2.5 py-2 text-xs font-medium ${i === 0 ? "bg-brand-600 text-white" : "text-brand-100"}`}>
                {label}
              </p>
            ))}
          </div>
          <div className="min-w-0 flex-1 bg-slate-50/60 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-lg font-extrabold text-slate-900">Dashboard</p>
              <div className="hidden gap-2 md:flex">
                <span className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                  <MapPin className="h-3 w-3" aria-hidden="true" /> All Locations <ChevronDown className="h-3 w-3" aria-hidden="true" />
                </span>
                <span className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                  <CalendarDays className="h-3 w-3" aria-hidden="true" /> Last 30 Days <ChevronDown className="h-3 w-3" aria-hidden="true" />
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat icon={Leaf} value="12,480" label="Active Plants" change="+6.8%" />
              <Stat icon={Boxes} value="4,320" label="Inventory Units" change="+3.9%" />
              <Stat icon={Factory} value="2,680" label="Batches" change="+5.1%" />
              <Stat icon={Store} value="$428,900" label="Retail Sales" change="+12.4%" />
            </div>
            <div className="mt-2 grid gap-2 xl:grid-cols-5">
              <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm xl:col-span-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-900">Operations Overview</p>
                  <p className="flex gap-2 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-700" /> Cultivation
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Manufacturing
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-200" /> Sales
                    </span>
                  </p>
                </div>
                <svg viewBox="0 0 420 140" className="mt-2 h-32 w-full" aria-hidden="true">
                  <defs>
                    <linearGradient id="hero-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#2f8a4c" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#2f8a4c" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[35, 70, 105].map((y) => (
                    <line key={y} x1="0" x2="420" y1={y} y2={y} stroke="#eef2ef" />
                  ))}
                  <path d={`${series[0].d} L420,140 L0,140 Z`} fill="url(#hero-fill)" />
                  {series.map((s, i) => (
                    <path key={i} d={s.d} fill="none" stroke="#237a3e" strokeOpacity={s.o} strokeWidth={s.w} strokeLinecap="round" />
                  ))}
                </svg>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm xl:col-span-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-900">Compliance Status</p>
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-800">Compliant</span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {checks.map(([label, state]) => (
                    <li key={label} className="flex items-center justify-between gap-2 whitespace-nowrap text-[10px]">
                      <span className="flex items-center gap-1.5 text-slate-700">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-white">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
                        </span>
                        {label}
                      </span>
                      <span className="text-brand-700">{state}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-2 grid gap-2 xl:grid-cols-[1fr_1.15fr]">
              <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-900 text-brand-100">
                  <Sprout className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 text-[11px]">
                  <p className="text-xs font-bold text-slate-900">Plant Tracking</p>
                  <p className="text-brand-700">Flower · Cultivation Room A</p>
                  <p className="text-slate-600">8,420 plants · Week 5 (Flower)</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                <p className="text-xs font-bold text-slate-900">Workflow Status</p>
                <ol className="mt-2 grid grid-cols-6">
                  {stages.map((stage, i) => (
                    <li key={stage} className="relative flex flex-col items-center gap-1">
                      {i > 0 ? <span className="absolute right-1/2 top-[7px] h-0.5 w-full bg-slate-200" aria-hidden="true" /> : null}
                      <span
                        className={`relative z-10 flex h-4 w-4 items-center justify-center rounded-full ${i < 2 ? "bg-brand-600 text-white" : "border-2 border-slate-300 bg-white"}`}
                      >
                        {i < 2 ? <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" /> : null}
                      </span>
                      <span className="max-w-full truncate text-[8px] text-slate-600">{stage}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-slate-500">Example screen. Figures are for illustration.</figcaption>
    </figure>
  );
}

/* ---------- The tablet in "See CannaTrace in Action" ---------- */

function TabletCultivation() {
  const rows = [
    ["PL-10428", "Gelato", "Flower", "35 days", "Room A"],
    ["PL-10429", "Gelato", "Flower", "35 days", "Room A"],
    ["PL-10430", "Blue Dream", "Vegetative", "18 days", "Room B"],
    ["PL-10431", "Blue Dream", "Vegetative", "18 days", "Room B"],
  ];
  return (
    <div className="rounded-[2rem] bg-slate-900 p-3 shadow-2xl">
      <div className="flex overflow-hidden rounded-[1.4rem] bg-white">
        <div className="hidden w-32 shrink-0 bg-brand-950 p-3 sm:block">
          <p className="mb-4 flex items-center gap-1 text-xs font-bold text-white">
            <LeafMark className="h-4 w-4 text-brand-200" /> CannaTrace
          </p>
          {["Dashboard", "Cultivation", "Inventory"].map((label, i) => (
            <p key={label} className={`mb-0.5 rounded-md px-2 py-1.5 text-[11px] ${i === 1 ? "bg-brand-600 text-white" : "text-brand-100"}`}>
              {label}
            </p>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4">
          <p className="text-sm font-extrabold text-slate-900">Cultivation</p>
          <p className="mt-2 flex gap-4 border-b border-slate-100 text-[11px] text-slate-500">
            <span className="border-b-2 border-brand-600 pb-1 font-semibold text-brand-700">Plants</span>
            <span>Batches</span>
            <span>Rooms</span>
            <span>Harvests</span>
          </p>
          <table className="mt-3 w-full text-left text-[10px]">
            <thead className="text-slate-500">
              <tr>
                {["Plant ID", "Strain", "Stage", "Age", "Location"].map((h) => (
                  <th key={h} className="pb-1 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {rows.map((r) => (
                <tr key={r[0]} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono">{r[0]}</td>
                  <td>{r[1]}</td>
                  <td>
                    <span className={`rounded px-1 py-0.5 ${r[2] === "Flower" ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-700"}`}>{r[2]}</span>
                  </td>
                  <td>{r[3]}</td>
                  <td>{r[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

const MODULES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Sprout, title: "Cultivation", text: "Track plants, batches, and growth from clone to harvest." },
  { icon: Boxes, title: "Inventory", text: "Manage inventory across all locations and stages." },
  { icon: ShieldCheck, title: "Compliance", text: "Stay compliant with real-time reporting and audit-ready records." },
  { icon: Factory, title: "Manufacturing", text: "Handle production, batching, formulations, and quality control." },
  { icon: Truck, title: "Distribution", text: "Streamline transfers, shipping, and chain-of-custody." },
  { icon: Store, title: "Retail", text: "Run compliant, data-driven retail operations and sales." },
];

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Zap, title: "Real-time inventory", text: "Accurate, up-to-the-minute visibility across your entire operation." },
  { icon: ShieldCheck, title: "Audit-ready traceability", text: "End-to-end tracking from seed to sale with compliant, exportable records." },
  { icon: BarChart3, title: "Faster operations", text: "Automate workflows, reduce manual work, and get more done with less effort." },
  { icon: MapPin, title: "Multi-location support", text: "Manage multiple facilities, licenses, and markets from a single platform." },
];

const AUDIENCE: { icon: LucideIcon; label: string }[] = [
  { icon: Users, label: "Growers" },
  { icon: Factory, label: "Producers" },
  { icon: Truck, label: "Distributors" },
  { icon: Store, label: "Retailers" },
];

function NavMenu({ label, items }: { label: string; items: [string, string][] }) {
  return (
    <div className="group relative">
      <button type="button" className="flex items-center gap-1 py-2 text-[15px] font-medium text-slate-800 hover:text-brand-700">
        {label} <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="invisible absolute left-0 top-full z-40 w-52 rounded-xl border border-slate-100 bg-white p-2 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        {items.map(([text, href]) => (
          <a key={text} href={href} className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-800">
            {text}
          </a>
        ))}
      </div>
    </div>
  );
}

export default async function HomePage() {
  const signedIn = Boolean(await getSession());
  const cta = signedIn ? { href: "/dashboard", label: "Go to Dashboard" } : { href: "/signup", label: "Get Started" };

  return (
    <div className="bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3">
          <Link href="/" aria-label="CannaTrace home">
            <Logo size="lg" />
          </Link>
          <nav className="hidden items-center gap-7 lg:flex">
            <NavMenu
              label="Features"
              items={[
                ["Cultivation", "#features"],
                ["Inventory", "#features"],
                ["Compliance", "#features"],
                ["Manufacturing", "#features"],
                ["Distribution", "#features"],
                ["Retail", "#features"],
              ]}
            />
            <NavMenu
              label="Solutions"
              items={[
                ["Growers", "#solutions"],
                ["Producers", "#solutions"],
                ["Distributors", "#solutions"],
                ["Retailers", "#solutions"],
              ]}
            />
            <a href="#contact" className="text-[15px] font-medium text-slate-800 hover:text-brand-700">
              Pricing
            </a>
            <NavMenu
              label="Resources"
              items={[
                ["Why CannaTrace", "#benefits"],
                ["See it in action", "#demo"],
                [signedIn ? "Go to dashboard" : "Sign in", signedIn ? "/dashboard" : "/login"],
              ]}
            />
            <a href="#contact" className="text-[15px] font-medium text-slate-800 hover:text-brand-700">
              Contact
            </a>
          </nav>
          <div className="flex items-center gap-3">
            {signedIn ? null : (
              <Link href="/login" className="hidden text-[15px] font-medium text-slate-800 hover:text-brand-700 sm:block">
                Sign in
              </Link>
            )}
            <a href={DEMO_LINK} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-800">
              Book a Demo
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#f4faf6] via-white to-[#e6f3ea]">
        <LeafMark className="pointer-events-none absolute -right-24 top-1/2 h-[34rem] w-[34rem] -translate-y-1/2 text-brand-600/[0.05]" />
        <div className="relative mx-auto grid max-w-[90rem] items-center gap-10 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:py-20 xl:px-10">
          <div>
            <span className="inline-block rounded-lg bg-brand-100/70 px-4 py-1.5 text-sm font-semibold text-brand-900">Cannabis Operations Software</span>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.02] tracking-tight text-slate-950 sm:text-6xl">
              From Seed to Sale.
              <br />
              <span className="text-brand-700">Fully Tracked</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-700">
              CannaTrace helps cannabis operators manage cultivation, inventory, compliance, manufacturing, distribution, and retail operations — all in one integrated platform.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={cta.href} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-7 py-3.5 text-base font-bold text-white shadow-sm hover:bg-brand-800">
                {cta.label} <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              <a href="#demo" className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-7 py-3 text-base font-bold text-slate-900 hover:border-brand-600">
                <Play className="h-5 w-5" aria-hidden="true" /> View Demo
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
              {["Compliance built in", "Scalable", "Secure", "Built for Cannabis"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-brand-600" strokeWidth={3} aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <HeroDashboard />
        </div>
      </section>

      {/* Platform */}
      <section id="features" className="scroll-mt-20 py-16">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">A Complete Cannabis Operations Platform</h2>
          <p className="mt-2 text-center text-slate-600">Power every stage of your cannabis business with integrated, compliant, and scalable tools.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {MODULES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold text-slate-950">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>

          {/* Benefits strip */}
          <div id="benefits" className="mt-8 grid scroll-mt-20 gap-6 rounded-2xl bg-brand-50/70 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-brand-100">
            {BENEFITS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4 lg:px-4 lg:first:pl-0">
                <Icon className="mt-0.5 h-7 w-7 shrink-0 text-brand-700" aria-hidden="true" />
                <div>
                  <h3 className="font-bold text-slate-950">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Audience, with the mascot */}
          <div id="solutions" className="mt-10 grid scroll-mt-20 items-center gap-8 lg:grid-cols-[1fr_1.3fr_1fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Made for cannabis operators</p>
              <h2 className="mt-1 text-2xl font-extrabold leading-tight text-slate-950">Built for growers, producers, distributors, and retailers.</h2>
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
              <Image src="/mascot.webp" alt="The CannaTrace mascot, a friendly towel holding a tablet showing the CannaTrace dashboard" width={140} height={127} className="h-28 w-auto shrink-0" />
              <p className="relative rounded-2xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-950">
                Every plant, package, and sale, tracked in one place. Need a hand? Ask me anything inside the app.
              </p>
            </div>
            <ul className="flex justify-between gap-4 lg:justify-end lg:gap-8">
              {AUDIENCE.map(({ icon: Icon, label }) => (
                <li key={label} className="flex flex-col items-center gap-2 text-sm font-semibold text-slate-800">
                  <Icon className="h-8 w-8 text-slate-700" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* See it in action */}
      <section id="demo" className="scroll-mt-20 px-5 pb-16">
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 overflow-hidden rounded-3xl bg-gradient-to-r from-brand-50 via-[#eef7f1] to-brand-100 px-6 py-12 sm:px-12 lg:grid-cols-2">
          <LeafMark className="pointer-events-none absolute -bottom-16 -right-10 h-80 w-80 text-brand-600/15" />
          <TabletCultivation />
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">See CannaTrace in Action</h2>
            <p className="mt-3 max-w-lg text-lg text-slate-700">Discover how CannaTrace can streamline your operations, ensure compliance, and help your cannabis business grow.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={DEMO_LINK} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-6 py-3 font-bold text-white shadow-sm hover:bg-brand-800">
                Book a Demo <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
              <a href="#features" className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-6 py-2.5 font-bold text-slate-900 hover:border-brand-600">
                <Play className="h-5 w-5" aria-hidden="true" /> Watch Product Tour
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer id="contact" className="scroll-mt-20 border-t border-slate-100 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-3">
          <div>
            <Logo />
            <p className="mt-2 text-sm text-slate-600">Seed-to-sale software for licensed cannabis businesses.</p>
          </div>
          <div className="text-sm">
            <p className="font-bold text-slate-950">Contact us</p>
            <p className="mt-1 text-slate-600">Questions, pricing, or a demo? Email us and we&apos;ll get back to you.</p>
            <ul className="mt-2 space-y-1">
              {CONTACT_EMAILS.map((email) => (
                <li key={email}>
                  <a href={`mailto:${email}`} className="font-semibold text-brand-700 hover:underline">
                    {email}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <a href={DEMO_LINK} className="font-semibold text-slate-800 hover:text-brand-700">
                Book a demo
              </a>
              <a href={PRICING_LINK} className="font-semibold text-slate-800 hover:text-brand-700">
                Ask about pricing
              </a>
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:items-end">
            <Link href={cta.href} className="font-semibold text-brand-700 hover:underline">
              {cta.label}
            </Link>
            {signedIn ? null : (
              <Link href="/login" className="text-slate-600 hover:text-brand-700">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
