import { Check, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { JsonLd, faqSchema } from "@/components/json-ld";
import { mailto } from "@/lib/contact";
import { liveDemoOn } from "@/lib/access";
import { FEATURES, PRICE_PER_FACILITY, priceSentence, usd } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing · Leaf2Sale",
  description: priceSentence(),
  alternates: { canonical: "/pricing" },
};

const DEMO_LINK = mailto("Leaf2Sale demo request");

const QUESTIONS: [string, string][] = [
  [
    "Is there a contract?",
    "No. You pay month to month and can stop anytime. Download all of your data as spreadsheets whenever you like, from Import and export.",
  ],
  [
    "What does switching cost?",
    "Nothing. Upload your NMS2S, Dutchie, or Flourish inventory and see every package before anything is saved.",
  ],
  [
    "Does it replace NMS2S?",
    "No. New Mexico requires every licensee to use NMS2S. Leaf2Sale runs your day-to-day work alongside it: labels, plants, inventory, sales, and Tally.",
  ],
  [
    "Can my store take card payments?",
    "Yes, in the way most cannabis stores already do. You run the card on your own card terminal or processor, then record it at the register as a debit or split payment, with the last 4 digits and approval number if you like. Leaf2Sale does not charge cards or connect to a processor, so there is no extra processing fee from us.",
  ],
  [
    "What does Tally cost?",
    "Tally runs on your business's own Claude account, so you pay Anthropic directly for what you use. Everything else is in the monthly price.",
  ],
  ["What if I run more than one facility?", `Each licensed facility is ${usd(PRICE_PER_FACILITY)} a month, with unlimited users at every one. Two facilities is ${usd(PRICE_PER_FACILITY * 2)} a month, three is ${usd(PRICE_PER_FACILITY * 3)}, and so on.`],
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd data={faqSchema(QUESTIONS)} />
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" aria-label="Leaf2Sale home">
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
          <p className="mt-4 text-lg text-slate-600">One plan with every feature and unlimited users. {usd(PRICE_PER_FACILITY)} a month for each facility you run.</p>
        </div>

        <section aria-label="Price" className="mx-auto mt-10 max-w-md">
          <div data-testid="price-per-facility" className="rounded-2xl border border-brand-500 bg-white p-6 text-center shadow-sm ring-2 ring-brand-500 sm:p-8">
            <h2 className="text-xl font-extrabold text-brand-950">Per facility</h2>
            <p className="mt-3">
              <span className="text-5xl font-extrabold tracking-tight text-slate-950">{usd(PRICE_PER_FACILITY)}</span>
              <span className="text-slate-600"> /month</span>
            </p>
            <p className="mt-2 text-sm text-slate-600">Every feature. Unlimited users. No contract.</p>
            <a
              href={mailto("Leaf2Sale: getting started")}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-700 px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-800"
            >
              Get started
            </a>
          </div>
        </section>

        <section aria-labelledby="included" className="mx-auto mt-10 max-w-3xl rounded-2xl border border-slate-200 p-6 sm:p-8" data-testid="included">
          <h2 id="included" className="text-xl font-extrabold text-brand-950">Everything included</h2>
          <ul className="mt-4 grid gap-x-8 gap-y-2.5 text-[15px] sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
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
            {liveDemoOn() ? (
              <Link href="/demo" prefetch={false} className="inline-flex min-h-11 items-center rounded-lg border border-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-900">
                Try the live demo
              </Link>
            ) : null}
          </div>
          <p className="mt-6 text-sm text-brand-200">
            Questions?{" "}
            <a href={mailto("Leaf2Sale question")} className="font-semibold text-white underline hover:no-underline">
              Contact us
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
