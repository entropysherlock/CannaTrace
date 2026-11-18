import { Check, Gift, MapPin, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { CONTACT_EMAILS, mailto } from "@/lib/contact";
import { FOUNDING, PLANS, usd } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing · CannaTrace",
  description: "Simple monthly pricing for New Mexico cannabis businesses. Founding customers get 60 days free and about half price for life.",
};

const FOUNDER_LINK = mailto("CannaTrace founding customer");
const DEMO_LINK = mailto("CannaTrace demo request");

const QUESTIONS: [string, string][] = [
  [
    "Is there a contract?",
    "No. You pay month to month and can stop anytime. Download all of your data as spreadsheets whenever you like, from Import and export.",
  ],
  [
    "What does switching cost?",
    "Nothing. Upload your NMS2S, Dutchie, or Flourish inventory and see every package before anything is saved. Founding customers get it done for them.",
  ],
  [
    "Does it replace NMS2S?",
    "No. New Mexico requires every licensee to use NMS2S. CannaTrace runs your day-to-day work alongside it: labels, plants, inventory, sales, and Tally.",
  ],
  [
    "What does Tally cost?",
    "Tally runs on your business's own Claude account, so you pay Anthropic directly for what you use. Everything else is in the monthly price.",
  ],
  ["Is the price per location?", "Yes, one price per license. Each facility you add is its own plan."],
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" aria-label="CannaTrace home">
            <Logo size="lg" />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hidden text-[15px] font-medium text-slate-800 hover:text-brand-700 sm:block">
              Sign in
            </Link>
            <a href={DEMO_LINK} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-800">
              Book a Demo
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-800">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Built in Albuquerque for New Mexico
          </p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-brand-950 sm:text-5xl">Simple pricing. No contracts.</h1>
          <p className="mt-4 text-lg text-slate-600">One monthly price per license, everything included for your kind of business.</p>
        </div>

        <section aria-labelledby="founding" className="mx-auto mt-10 max-w-3xl rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 sm:p-8" data-testid="founding-offer">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="founding" className="flex items-center gap-2 text-xl font-extrabold text-amber-950">
                <Gift className="h-5 w-5" aria-hidden="true" />
                Founding customers: first {FOUNDING.spots} businesses
              </h2>
              <ul className="mt-3 space-y-1.5 text-amber-950">
                {FOUNDING.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
                    {perk}
                  </li>
                ))}
              </ul>
            </div>
            <a href={FOUNDER_LINK} className="inline-flex min-h-11 items-center rounded-lg bg-amber-500 px-5 text-sm font-bold text-amber-950 shadow-sm hover:bg-amber-400">
              Claim a founding spot
            </a>
          </div>
        </section>

        <section aria-label="Plans" className="mt-10 grid gap-6 md:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              data-testid={`plan-${plan.id}`}
              className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm sm:p-8 ${plan.id === "pro" ? "border-brand-500 ring-2 ring-brand-500" : "border-slate-200"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-2xl font-extrabold text-brand-950">{plan.name}</h2>
                {plan.id === "pro" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-bold text-white">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    Everything
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-slate-600">{plan.forWho}</p>
              <p className="mt-5">
                <span className="text-5xl font-extrabold tracking-tight text-slate-950">{usd(plan.price)}</span>
                <span className="text-slate-600"> /month per license</span>
              </p>
              <p className="mt-1 text-sm font-semibold text-amber-800">
                Founding customers: {usd(plan.founderPrice)}/month for life, after {FOUNDING.freeDays} days free
              </p>
              <ul className="mt-6 flex-1 space-y-2.5 text-[15px]">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={mailto(`CannaTrace ${plan.name} plan`)}
                className={`mt-8 inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-bold shadow-sm ${
                  plan.id === "pro" ? "bg-brand-700 text-white hover:bg-brand-800" : "border-2 border-brand-200 text-brand-800 hover:border-brand-500 hover:bg-brand-50"
                }`}
              >
                Get {plan.name}
              </a>
            </div>
          ))}
        </section>

        <section aria-labelledby="faq" className="mx-auto mt-16 max-w-3xl">
          <h2 id="faq" className="text-2xl font-extrabold text-brand-950">Questions</h2>
          <dl className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {QUESTIONS.map(([q, a]) => (
              <div key={q} className="px-5 py-4">
                <dt className="font-bold text-slate-900">{q}</dt>
                <dd className="mt-1 text-slate-600">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mx-auto mt-16 max-w-3xl rounded-2xl bg-brand-950 px-6 py-10 text-center text-white">
          <h2 className="text-2xl font-extrabold">See it on your own inventory</h2>
          <p className="mt-2 text-brand-100">15 minutes, at your grow or shop. We bring your data over while you watch.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href={DEMO_LINK} className="inline-flex min-h-11 items-center rounded-lg bg-white px-5 text-sm font-bold text-brand-900 hover:bg-brand-50">
              Book a demo
            </a>
            <Link href="/demo" prefetch={false} className="inline-flex min-h-11 items-center rounded-lg border border-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-900">
              Try the live demo
            </Link>
          </div>
          <p className="mt-6 text-sm text-brand-200">
            Or email{" "}
            {CONTACT_EMAILS.map((e, i) => (
              <span key={e}>
                {i ? " or " : ""}
                <a href={`mailto:${e}`} className="font-semibold text-white underline hover:no-underline">
                  {e}
                </a>
              </span>
            ))}
          </p>
        </section>
      </main>
    </div>
  );
}
