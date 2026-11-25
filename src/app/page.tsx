import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ChevronDown,
  Eye,
  Factory,
  FileCheck,
  GraduationCap,
  History,
  MapPin,
  Play,
  ShieldCheck,
  Sparkles,
  Sprout,
  Store,
  Tag,
  Truck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DemoVideoButton, DemoVideoPlayer, DemoVideoPoster } from "@/components/demo-video";
import { LeafMark, Logo } from "@/components/logo";
import { liveDemoOn, signupsOpen } from "@/lib/access";
import { mailto } from "@/lib/contact";
import { FOUNDING, PRICES, facilitiesLabel, priceSentence, usd } from "@/lib/pricing";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Leaf2Sale · Seed-to-Sale Operations Platform",
  description: "Leaf2Sale helps cannabis operators manage cultivation, inventory, compliance, manufacturing, distribution, and retail operations in one integrated platform.",
};

const DEMO_LINK = mailto("Leaf2Sale demo request");

// Reads the sign-in cookie, so the buttons can say "Go to dashboard" for people already signed in.
export const instant = false;

/* ---------- Real screens from the app, shown with sample data ---------- */

/** A screenshot of the app in a simple browser frame. */
function Screen({ src, alt, priority = false, className = "" }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_60px_-20px_rgba(12,48,32,0.35)] ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="ml-3 truncate rounded-md bg-white px-3 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">leaf2sale.com</span>
      </div>
      <Image src={src} alt={alt} width={2000} height={1250} priority={priority} sizes="(min-width: 1024px) 60vw, 100vw" className="h-auto w-full" />
    </div>
  );
}

/** A phone screenshot in a simple phone frame. */
function Phone({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mx-auto w-full max-w-[260px] rounded-[2.2rem] border-[10px] border-slate-900 bg-slate-900 shadow-xl">
      <Image src={src} alt={alt} width={780} height={1688} sizes="260px" className="h-auto w-full rounded-[1.6rem]" />
    </div>
  );
}

/* ---------- The tablet in "See Leaf2Sale in Action" ---------- */

/* ---------- The tour: one real screen per part of the app ---------- */

const TOUR: { id: string; icon: LucideIcon; kicker: string; title: string; text: string; points: string[]; src: string; alt: string }[] = [
  {
    id: "cultivation",
    icon: Sprout,
    kicker: "Cultivation",
    title: "Every plant, from clone to harvest",
    text: "Start batches, tag plants, move them through veg and flower, and record harvests without spreadsheets.",
    points: ["Plant batches, tags, phases, and rooms", "Harvests with wet and dry weight, waste, and packaging", "Tasks for the crew, with due dates", "IDs made for you, or scan your own tags"],
    src: "/site/cultivation.webp",
    alt: "The Leaf2Sale Cultivation page with plant batches, phase counts, and open tasks",
  },
  {
    id: "inventory",
    icon: Boxes,
    kicker: "Inventory",
    title: "Know exactly what's on the shelf",
    text: "Every package with its tag, item, quantity, room, and status. Scan a tag to find it in a second.",
    points: ["Receive deliveries, move, split, merge, and adjust", "Lab results, holds, and quarantine", "Cycle counts that fix the numbers and keep the history", "Rooms, vaults, and racks"],
    src: "/site/inventory.webp",
    alt: "The Leaf2Sale Inventory page listing packages with tags, rooms, quantities, and statuses",
  },
  {
    id: "manufacturing",
    icon: Factory,
    kicker: "Manufacturing",
    title: "Production runs with yield and cost",
    text: "Turn bulk flower and inputs into finished products, and see what each unit really costs.",
    points: ["Recipes with inputs and expected output", "Runs that use up inputs and make new packages", "Yield and cost per unit, worked out for you", "Every input traced to every output"],
    src: "/site/manufacturing.webp",
    alt: "The Leaf2Sale Manufacturing overview with runs in progress, yield, and cost per unit",
  },
  {
    id: "distribution",
    icon: Truck,
    kicker: "Distribution",
    title: "Wholesale from order to invoice",
    text: "Take orders from licensed buyers, pick and pack the right packages, ship with a manifest, and get paid.",
    points: ["Orders, picking, and packing", "Buyer licenses checked before anything ships", "Drivers, vehicles, and manifests", "Price lists, invoices, and what's owed"],
    src: "/site/distribution.webp",
    alt: "The Leaf2Sale Distribution page with wholesale orders and invoices",
  },
  {
    id: "retail",
    icon: Store,
    kicker: "Register",
    title: "A register that knows the rules",
    text: "Scan the ID, ring up the sale, and let Leaf2Sale keep every purchase inside the state's limits.",
    points: ["ID scan checks age and expiry", "Purchase limits shown as you add products", "Discounts, cannabis excise and sales tax", "Held carts, cash drawer, and a customer screen"],
    src: "/site/register.webp",
    alt: "The Leaf2Sale register with products, a cart, purchase limits, a veteran discount, and taxes",
  },
  {
    id: "labels",
    icon: Tag,
    kicker: "SmartLabel AI",
    title: "Compliant labels in a few clicks",
    text: "Pick the packages, pick a template, and print. SmartLabel AI checks each label before it prints.",
    points: ["Package, product, plant, batch, and transfer labels", "Templates you can change", "Works with your label printers", "A history of every print job"],
    src: "/site/labels.webp",
    alt: "The Leaf2Sale SmartLabel AI page choosing packages and a label template",
  },
  {
    id: "compliance",
    icon: ShieldCheck,
    kicker: "Compliance",
    title: "Your state's rules, built in",
    text: "Leaf2Sale scores how well you're following your state's rules and tells you what to fix, with a link to fix it.",
    points: ["New Mexico rules in depth, plus 22 more adult-use states", "A compliance score and a to-fix list", "Purchase limits, ages, testing, and waste rules", "Every rule linked to the regulation"],
    src: "/site/rules.webp",
    alt: "The Leaf2Sale State rules page with a compliance score and New Mexico rules in effect",
  },
  {
    id: "reporting",
    icon: FileCheck,
    kicker: "State reporting",
    title: "A reporting queue you can trust",
    text: "Every change that the state needs to hear about is queued, sent, and tracked, so nothing slips through.",
    points: ["See what's waiting, sent, or failed", "Records to enter by hand are listed for you", "New Mexico NMS2S connection: state access requested", "Practice mode to try it with nothing sent"],
    src: "/site/compliance.webp",
    alt: "The Leaf2Sale State reporting page with recent records marked sent",
  },
  {
    id: "tally",
    icon: Sparkles,
    kicker: "Tally, the built-in assistant",
    title: "Ask your business anything",
    text: "Tally answers from your live data, right inside Leaf2Sale. When it suggests a change, nothing happens until you press Confirm, and every change can be undone.",
    points: ["Plain-English questions, answers from your data", "Drop in a file and ask about it", "Changes wait for your Confirm", "One-click Undo"],
    src: "/site/tally.webp",
    alt: "Tally, the Leaf2Sale assistant, answering a question with a table from live data",
  },
  {
    id: "watch",
    icon: Eye,
    kicker: "Tally Watch",
    title: "Problems found before an inspector finds them",
    text: "Tally Watch checks your business on its own and lists what needs a look, each with a fix ready to approve.",
    points: ["Failed lab tests that are still sellable", "Packages missing labels", "Differences with the state system", "Overdue balances and expiring licenses"],
    src: "/site/watch.webp",
    alt: "The Leaf2Sale Tally Watch page with an item to fix and a Prepare the labels button",
  },
  {
    id: "reports",
    icon: BarChart3,
    kicker: "Reports",
    title: "The numbers that run the business",
    text: "Inventory value, sales by day, wholesale owed, and reporting health, always up to date.",
    points: ["Inventory value by category and age", "Retail sales by day, with taxes and discounts", "Wholesale invoiced, paid, and overdue", "Export to a spreadsheet"],
    src: "/site/reports.webp",
    alt: "The Leaf2Sale Reports page with inventory value, retail sales by day, and wholesale totals",
  },
  {
    id: "walkthroughs",
    icon: GraduationCap,
    kicker: "Show me how",
    title: "New staff learn on the job",
    text: "Guided walkthroughs highlight each step on the real screen, so a new budtender or trimmer can do it right the first time.",
    points: ["Receive a delivery, start a grow, harvest, and more", "Each step highlighted on the screen", "Pick up where you left off", "No training videos to watch"],
    src: "/site/walkthrough.webp",
    alt: "A Leaf2Sale guided walkthrough highlighting the package tag field on the Receive package page",
  },
  {
    id: "audit",
    icon: History,
    kicker: "Audit trail",
    title: "Who did what, and when",
    text: "Every change is recorded with the person, the time, and what changed, ready for an audit.",
    points: ["Every sale, move, adjustment, and edit", "The person and the exact time", "Changes made through Tally are marked", "Undos are recorded too"],
    src: "/site/audit.webp",
    alt: "The Leaf2Sale Audit trail listing each change with the person and time",
  },
];

const FAQ: [string, string][] = [
  ["Is this real software?", "Yes. Every screen on this page is a real screenshot of Leaf2Sale, filled with sample data for a made-up business. You can sign up, or open the sample business and click around yourself."],
  ["Which states does Leaf2Sale work in?", "Leaf2Sale is made in New Mexico, and New Mexico's rules are built in the deepest: purchase limits, ages, lab testing, waste, manifests, and recalls. Colorado, California, and Michigan have detailed rules too, and 19 more adult-use states have their purchase limits, minimum age, and testing rules, each linked to the regulation."],
  ["Does it connect to NMS2S or Metrc?", "New Mexico uses NMS2S, which replaced BioTrack in September 2026. Leaf2Sale has asked the Cannabis Control Division for integrator access; a live connection turns on once the state approves it. In Metrc states, a live connection also needs state approval first. Until then, Leaf2Sale keeps a queue of everything the state needs and lists exactly what to enter by hand, and you keep using NMS2S as the state requires."],
  ["Can I bring my data from another system?", "Yes. Leaf2Sale imports from NMS2S, Dutchie, and Flourish exports, including large inventories. For founding customers, we do the move for you."],
  ["Do I need special hardware?", "No. Leaf2Sale runs in the web browser on computers, tablets, and phones. It works with ordinary USB or Bluetooth barcode scanners and label printers."],
  ["Who can see what?", "Each person gets a role, like owner, manager, cultivation, sales, or budtender, and only sees and changes what that role allows. Every change is in the audit trail."],
  ["How much does it cost?", priceSentence()],
];

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

const DEMO_NOTICES: Record<string, string> = {
  off: "The live demo is switched off right now. Email us and we'll walk you through it.",
  busy: "The live demo is still being set up. Try again in a few seconds.",
  error: "The live demo could not open just now. Try again in a minute, or email us.",
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  const demoParam = (await searchParams).demo;
  const demoNotice = typeof demoParam === "string" ? DEMO_NOTICES[demoParam] : undefined;
  const signedIn = Boolean(await getSession());
  // Invite-only: the main button signs people in instead of offering a sign-up that's closed.
  const cta = signedIn ? { href: "/dashboard", label: "Go to Dashboard" } : signupsOpen() ? { href: "/signup", label: "Get Started" } : { href: "/login", label: "Sign In" };
  const demoOn = liveDemoOn();

  return (
    <div className="bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3">
          <Link href="/" aria-label="Leaf2Sale home">
            <Logo size="lg" />
          </Link>
          <nav className="hidden items-center gap-7 lg:flex">
            <NavMenu
              label="Features"
              items={[
                ["Cultivation", "#cultivation"],
                ["Inventory", "#inventory"],
                ["Manufacturing", "#manufacturing"],
                ["Distribution", "#distribution"],
                ["Register", "#retail"],
                ["SmartLabel AI", "#labels"],
                ["Compliance", "#compliance"],
                ["Tally assistant", "#tally"],
                ["Tally Watch", "#watch"],
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
            <Link href="/pricing" className="text-[15px] font-medium text-slate-800 hover:text-brand-700">
              Pricing
            </Link>
            <NavMenu
              label="Resources"
              items={[
                ["Take the tour", "#tour"],
                ["Why Leaf2Sale", "#benefits"],
                ["See it in action", "#demo"],
                ["Questions", "#faq"],
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
            {demoOn ? (
              <Link href="/demo" prefetch={false} className="hidden rounded-lg border-2 border-brand-700 px-4 py-2 text-sm font-bold text-brand-800 hover:bg-brand-50 sm:block">
                Try Live Demo
              </Link>
            ) : null}
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
              Leaf2Sale helps cannabis operators manage cultivation, inventory, compliance, manufacturing, distribution, and retail operations — all in one integrated platform.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={cta.href} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-7 py-3.5 text-base font-bold text-white shadow-sm hover:bg-brand-800">
                {cta.label} <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
              {demoOn ? (
                <Link href="/demo" prefetch={false} className="inline-flex items-center gap-2 rounded-xl border-2 border-brand-700 bg-white px-7 py-3 text-base font-bold text-brand-800 hover:bg-brand-50">
                  Try Live Demo <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </Link>
              ) : null}
              <DemoVideoButton className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-7 py-3 text-base font-bold text-slate-900 hover:border-brand-600">
                <Play className="h-5 w-5" aria-hidden="true" /> Watch the Video Tour
              </DemoVideoButton>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
              {["Compliance built in", "Scalable", "Secure", "Built for Cannabis"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-brand-600" strokeWidth={3} aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <figure>
            <Screen src="/site/command-center.webp" alt="The Leaf2Sale Dashboard with plants, packages, sales, the operations flow, charts, and the Tally assistant" priority />
            <figcaption className="mt-2 text-center text-xs text-slate-500">The real Leaf2Sale Dashboard, shown with sample data.</figcaption>
          </figure>
        </div>
      </section>

      {/* Quick facts */}
      <section aria-label="At a glance" className="border-y border-slate-100 bg-white">
        <ul className="mx-auto grid max-w-7xl gap-6 px-5 py-8 text-center sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["13", "parts of the business in one app"],
            ["23", "states' rules built in"],
            [String(FOUNDING.freeDays), "days free for founding customers"],
            ["$0", "extra for more team members"],
          ].map(([n, label]) => (
            <li key={label}>
              <p className="text-3xl font-extrabold text-brand-700">{n}</p>
              <p className="mt-1 text-sm text-slate-600">{label}</p>
            </li>
          ))}
        </ul>
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
              <Image src="/mascot.webp" alt="The Leaf2Sale mascot, a friendly towel holding a tablet showing the Leaf2Sale dashboard" width={140} height={127} className="h-28 w-auto shrink-0" />
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

      {/* The tour */}
      <section id="tour" className="scroll-mt-20 bg-slate-50/70 py-16" aria-labelledby="tour-heading">
        <div className="mx-auto max-w-7xl px-5">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-brand-700">Take the tour</p>
          <h2 id="tour-heading" className="mt-1 text-center text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
            See every part of Leaf2Sale
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">Real screens from the app, filled with sample data for a made-up grow and store in New Mexico.</p>
          <nav aria-label="Tour" className="mt-6 flex flex-wrap justify-center gap-2">
            {TOUR.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-brand-500 hover:text-brand-800">
                {t.kicker}
              </a>
            ))}
          </nav>
          <div className="mt-12 space-y-20">
            {TOUR.map((t, i) => (
              <article key={t.id} id={t.id} className="grid scroll-mt-24 items-center gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-12" data-testid="tour-section">
                <div className={i % 2 ? "lg:order-2" : ""}>
                  <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand-700">
                    <t.icon className="h-5 w-5" aria-hidden="true" /> {t.kicker}
                  </p>
                  <h3 className="mt-2 text-2xl font-extrabold leading-tight text-slate-950 sm:text-3xl">{t.title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-700">{t.text}</p>
                  <ul className="mt-4 space-y-2">
                    {t.points.map((point) => (
                      <li key={point} className="flex items-start gap-2 text-sm text-slate-800">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" strokeWidth={3} aria-hidden="true" /> {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <Screen src={t.src} alt={t.alt} className={i % 2 ? "lg:order-1" : ""} />
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* On any device */}
      <section id="devices" className="scroll-mt-20 py-16">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Phones, tablets, and computers</p>
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">Take it into the grow room</h2>
            <p className="mt-3 text-lg text-slate-700">
              Leaf2Sale works in the web browser on any device. Check the numbers from your phone, scan tags on a tablet in the vault, and run the register on a
              laptop. Nothing to install.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-slate-800">
              {["Works with USB and Bluetooth barcode scanners", "The register runs full screen on a tablet or laptop", "Sign in from anywhere, see only what your role allows"].map((x) => (
                <li key={x} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" strokeWidth={3} aria-hidden="true" /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-6">
            <Phone src="/site/phone-dashboard.webp" alt="The Leaf2Sale Dashboard on a phone" />
            <Phone src="/site/phone-inventory.webp" alt="Leaf2Sale inventory on a phone" />
            <Phone src="/site/phone-register.webp" alt="The Leaf2Sale register on a phone" />
          </div>
        </div>
      </section>

      {/* Switching */}
      <section id="switch" className="scroll-mt-20 px-5 pb-16">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-3xl bg-brand-950 px-6 py-12 text-white sm:px-12 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-200">Switching is easy</p>
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Bring your inventory with you</h2>
            <p className="mt-3 text-lg text-brand-100">
              Export from your current system and drop the file into Leaf2Sale. It reads the file, shows you what it found, and asks before importing anything.
            </p>
          </div>
          <ol className="space-y-4">
            {[
              ["Export", "Download your inventory from NMS2S, Dutchie, or Flourish."],
              ["Check", "Leaf2Sale shows what it found and anything to fix, store by store."],
              ["Import", "Thousands of packages come over in one go, ready to sell."],
            ].map(([title, text], n) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 font-extrabold">{n + 1}</span>
                <span>
                  <span className="block font-bold">{title}</span>
                  <span className="block text-sm text-brand-100">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 px-5 pb-16" aria-labelledby="pricing-heading">
        <div className="mx-auto max-w-5xl text-center">
          <h2 id="pricing-heading" className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
            Simple pricing, every feature included
          </h2>
          <p className="mt-2 text-slate-600">No contracts and no per-user charges. Pay month to month.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {PRICES.map((plan) => (
              <div key={plan.facilities} className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm">
                <p className="font-bold text-slate-900">{facilitiesLabel(plan.facilities)}</p>
                <p className="mt-2 text-4xl font-extrabold text-slate-950">
                  {usd(plan.price)}
                  <span className="text-base font-semibold text-slate-500">/month</span>
                </p>
                <p className="mt-1 text-sm font-semibold text-brand-700">Founding customers: {usd(plan.founderPrice)}/month for life</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-600">
            The first {FOUNDING.spots} founding customers also get {FOUNDING.freeDays} days free and we bring their inventory over for them.{" "}
            <Link href="/pricing" className="font-semibold text-brand-700 underline hover:no-underline">
              See full pricing
            </Link>
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 px-5 pb-16" aria-labelledby="faq-heading">
        <div className="mx-auto max-w-3xl">
          <h2 id="faq-heading" className="text-center text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
            Questions people ask
          </h2>
          <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-slate-900">
                  {q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="mt-2 leading-relaxed text-slate-700">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* See it in action */}
      <section id="demo" className="scroll-mt-20 px-5 pb-16">
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 overflow-hidden rounded-3xl bg-gradient-to-r from-brand-50 via-[#eef7f1] to-brand-100 px-6 py-12 sm:px-12 lg:grid-cols-2">
          <LeafMark className="pointer-events-none absolute -bottom-16 -right-10 h-80 w-80 text-brand-600/15" />
          <div className="relative">
            <DemoVideoPoster />
          </div>
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">See Leaf2Sale in Action</h2>
            <p className="mt-3 max-w-lg text-lg text-slate-700">
              A one-minute tour: the Dashboard, plants, inventory, manufacturing, wholesale, the register, labels, state rules, Tally, and reports.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <DemoVideoButton className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-6 py-3 font-bold text-white shadow-sm hover:bg-brand-800">
                <Play className="h-5 w-5" aria-hidden="true" /> Watch the Video Tour
              </DemoVideoButton>
              {demoOn ? (
                <Link href="/demo" prefetch={false} className="inline-flex items-center gap-2 rounded-xl border-2 border-brand-700 bg-white px-6 py-2.5 font-bold text-brand-800 hover:bg-brand-50">
                  Try Live Demo <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </Link>
              ) : null}
              <a href={DEMO_LINK} className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-6 py-2.5 font-bold text-slate-900 hover:border-brand-600">
                Book a Demo <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </a>
            </div>
            {demoOn ? (
              <p className="mt-4 max-w-lg text-sm text-slate-600">
                Prefer to click around yourself?{" "}
                <Link href="/demo" prefetch={false} className="font-semibold text-brand-700 underline hover:no-underline">
                  Open the sample business
                </Link>
                . It&apos;s filled with made-up data and starts fresh every day.
              </p>
            ) : null}
            {demoNotice ? (
              <p role="status" className="mt-3 max-w-lg rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                {demoNotice}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Last call */}
      <section className="px-5 pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">Ready to see it with your own data?</h2>
          <p className="mt-3 text-lg text-slate-700">Book a demo and we&apos;ll walk you through Leaf2Sale and answer your questions.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href={DEMO_LINK} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-7 py-3.5 text-base font-bold text-white shadow-sm hover:bg-brand-800">
              Book a Demo <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </a>
            <Link href={cta.href} className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-7 py-3 text-base font-bold text-slate-900 hover:border-brand-600">
              {cta.label}
            </Link>
          </div>
        </div>
      </section>

      <DemoVideoPlayer />

      <footer id="contact" className="scroll-mt-20 border-t border-slate-100 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-3">
          <div>
            <Logo />
            <p className="mt-2 text-sm text-slate-600">Seed-to-sale software for licensed cannabis businesses.</p>
          </div>
          <div className="text-sm">
            <p className="font-bold text-slate-950">Contact us</p>
            <p className="mt-1 text-slate-600">Questions, pricing, or a demo? Email us and we&apos;ll get back to you.</p>
            <a
              href={mailto("Leaf2Sale question")}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800"
            >
              Contact us
            </a>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <a href={DEMO_LINK} className="font-semibold text-slate-800 hover:text-brand-700">
                Book a demo
              </a>
              <Link href="/pricing" className="font-semibold text-slate-800 hover:text-brand-700">
                See pricing
              </Link>
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
        <p className="mx-auto flex max-w-7xl flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
          <Link href="/terms" className="hover:text-brand-700">
            Terms of Service
          </Link>
          <Link href="/privacy" className="hover:text-brand-700">
            Privacy Policy
          </Link>
          <Link href="/data-agreement" className="hover:text-brand-700">
            Data Agreement
          </Link>
        </p>
      </footer>
    </div>
  );
}
