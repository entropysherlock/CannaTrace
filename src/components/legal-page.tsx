import Link from "next/link";
import { Logo } from "@/components/logo";
import { mailto } from "@/lib/contact";
import { LEGAL, type LegalSection } from "@/lib/legal";

const OTHER = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/data-agreement", label: "Data Agreement" },
];

/** One layout for every legal page: plain headings, readable width, links to the other two. */
export function LegalPage({ title, intro, sections, current }: { title: string; intro: string; sections: LegalSection[]; current: string }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" aria-label="CannaTrace home">
            <Logo size="lg" />
          </Link>
          <Link href="/login" className="text-[15px] font-medium text-slate-800 hover:text-brand-700">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Effective {LEGAL.effective}</p>
        <p role="note" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {LEGAL.draftNotice}
        </p>
        <p className="mt-6 text-base leading-relaxed text-slate-700">{intro}</p>
        {sections.map((s, i) => (
          <section key={s.heading} className="mt-8">
            <h2 className="text-xl font-bold text-slate-900">
              {i + 1}. {s.heading}
            </h2>
            {s.paragraphs?.map((p) => (
              <p key={p} className="mt-2 text-base leading-relaxed text-slate-700">
                {p}
              </p>
            ))}
            {s.items ? (
              <ul className="mt-2 list-disc space-y-1.5 pl-6 text-base leading-relaxed text-slate-700">
                {s.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        <section className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-600">
          <p>
            Questions?{" "}
            <a href={mailto(`CannaTrace ${title}`)} className="font-semibold text-brand-700 hover:underline">
              Email us
            </a>
            .
          </p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            {OTHER.filter((o) => o.href !== current).map((o) => (
              <Link key={o.href} href={o.href} className="font-semibold text-brand-700 hover:underline">
                {o.label}
              </Link>
            ))}
          </p>
        </section>
      </main>
    </div>
  );
}
