import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, faqSchema } from "@/components/json-ld";
import { Logo } from "@/components/logo";
import { mailto } from "@/lib/contact";
import { SITE_URL } from "@/lib/site";

const PATH = "/new-mexico-cannabis-seed-to-sale-software";
const TITLE = "New Mexico Cannabis Seed-to-Sale Software · Leaf2Sale";
const DESCRIPTION =
  "Leaf2Sale is seed-to-sale software built in Albuquerque for New Mexico cannabis licensees: plants, inventory, labels, lab results, waste, manifests, and a retail register with purchase limits built in.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PATH, type: "website" },
};

const QUESTIONS: [string, string][] = [
  [
    "Does Leaf2Sale replace NMS2S?",
    "No. New Mexico requires every licensee to use NMS2S, which replaced BioTrack in September 2026. Leaf2Sale runs your day-to-day work alongside it: labels, plants, inventory, sales, and the records an inspector asks for.",
  ],
  [
    "Does Leaf2Sale connect to NMS2S?",
    "Leaf2Sale has asked the Cannabis Control Division for integrator access. A live connection turns on only once the state approves it. Until then Leaf2Sale keeps a queue of what the state needs and lists exactly what to enter by hand.",
  ],
  [
    "Can I move my data over from Dutchie, Flourish, or NMS2S?",
    "Yes. Leaf2Sale imports from NMS2S, Dutchie, and Flourish exports, and shows every package before anything is saved.",
  ],
  [
    "What does it cost?",
    "Plans are priced by how many facilities you run, with every feature included, no contract, and no per-user fees. See the pricing page for the current numbers.",
  ],
];

const SECTIONS: { heading: string; body: string; points: string[] }[] = [
  {
    heading: "Made in New Mexico, for New Mexico rules",
    body: "Leaf2Sale is built in Albuquerque, and New Mexico's rules are built in the deepest. The software knows the state's purchase limits, minimum age, lab testing, waste, manifest, and recall rules, so staff are stopped before a mistake becomes a violation.",
    points: ["Retail purchase limits and 21+ checks at the register", "Lab test status that blocks untested product from sale", "Waste held for the required period, with the destruction recorded on video", "Manifests and recall tracking for distribution"],
  },
  {
    heading: "From seed to sale in one place",
    body: "Cultivators, producers, distributors, and retailers use the same system, so a package keeps its history from the plant to the shelf.",
    points: ["Plants, batches, and harvests with IDs made for you", "Inventory, lab results, counts, and a full audit trail", "Manufacturing with recipes, runs, yield, and cost per unit", "Wholesale orders, picking, manifests, and invoices"],
  },
  {
    heading: "Labels that follow the rules",
    body: "SmartLabel AI makes New Mexico product and package labels, checks them before they print, and works with ordinary label printers, including Zebra.",
    points: ["Product and package label templates", "Checks for required label content before printing", "Works with Zebra and other label printers"],
  },
  {
    heading: "A register that keeps working offline",
    body: "The retail register checks age, purchase limits, and lab status on the device, so cash sales can continue through an internet outage and are sent to Leaf2Sale when the connection returns.",
    points: ["Cash sales saved on the device during an outage", "An outage log for your records", "Refunds go back the way the customer paid"],
  },
];

export default function NewMexicoPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <JsonLd data={faqSchema(QUESTIONS)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: TITLE,
          description: DESCRIPTION,
          url: `${SITE_URL}${PATH}`,
          isPartOf: { "@type": "WebSite", name: "Leaf2Sale", url: SITE_URL },
          about: "Seed-to-sale software for New Mexico cannabis licensees",
        }}
      />
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" aria-label="Leaf2Sale home">
            <Logo size="lg" />
          </Link>
          <Link href="/pricing" className="text-[15px] font-medium text-slate-800 hover:text-brand-700">
            Pricing
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-4xl font-extrabold tracking-tight text-brand-950 sm:text-5xl">Seed-to-sale software for New Mexico cannabis businesses</h1>
        <p className="mt-5 text-lg leading-relaxed text-slate-700">
          Leaf2Sale manages cultivation, inventory, labels, compliance, manufacturing, distribution, and retail for licensed New Mexico cannabis operators, in one platform that runs in any web browser.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={mailto("Leaf2Sale demo request")} className="rounded-lg bg-brand-700 px-5 py-3 text-sm font-bold text-white hover:bg-brand-800">
            Book a demo
          </a>
          <Link href="/pricing" className="rounded-lg border-2 border-slate-300 px-5 py-3 text-sm font-bold text-slate-900 hover:border-brand-600">
            See pricing
          </Link>
        </div>

        {SECTIONS.map((s) => (
          <section key={s.heading} className="mt-12">
            <h2 className="text-2xl font-extrabold text-brand-950">{s.heading}</h2>
            <p className="mt-3 leading-relaxed text-slate-700">{s.body}</p>
            <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-700">
              {s.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className="mt-12">
          <h2 className="text-2xl font-extrabold text-brand-950">Questions</h2>
          <dl className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {QUESTIONS.map(([q, a]) => (
              <div key={q} className="px-5 py-4">
                <dt className="font-bold text-slate-900">{q}</dt>
                <dd className="mt-1 text-slate-600">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
