import { AlertTriangle, CheckCircle2, CircleDashed, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { DocProposal } from "@/lib/scan/types";

const CHIP = {
  ok: { Icon: CheckCircle2, cls: "text-brand-700", text: "Read" },
  check: { Icon: AlertTriangle, cls: "text-amber-700", text: "Check" },
  missing: { Icon: CircleDashed, cls: "text-slate-400", text: "Not found" },
} as const;

/** What Tally found on a document it can recognise: laid out beside the original so it can be checked at a glance. */
export function DocReview({ attachmentId, name, isPdf, proposal }: { attachmentId: string; name: string; isPdf: boolean; proposal: DocProposal }) {
  const src = `/api/assistant/attachments/${attachmentId}`;
  const sensitive = proposal.docType === "SENSITIVE_ID";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="doc-review">
      <div className="lg:sticky lg:top-4 lg:self-start">
        {sensitive ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-500">
            <ShieldCheck className="h-12 w-12" aria-hidden="true" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {isPdf ? (
              <object data={src} type="application/pdf" className="h-[70vh] w-full" aria-label={name}>
                <p className="p-6 text-sm text-slate-600">This browser can&apos;t show the PDF here. <a className="font-semibold underline" href={src}>Open it</a>.</p>
              </object>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={name} className="max-h-[75vh] w-full bg-slate-100 object-contain" />
            )}
          </div>
        )}
        <p className="mt-2 truncate text-xs text-slate-500">{name}</p>
      </div>

      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Tally recognised</p>
          <h2 className="font-display text-xl font-bold" data-testid="doc-label">{proposal.label}</h2>
          <p className="mt-1 text-sm text-slate-600">{proposal.summary}</p>
        </section>

        {proposal.warnings.length ? (
          <ul className="space-y-2" data-testid="doc-warnings">
            {proposal.warnings.map((w) => (
              <li key={w} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        ) : null}

        {proposal.fields.length ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {proposal.fields.map((f) => {
                const c = CHIP[f.confidence];
                return (
                  <div key={f.key} data-testid={`doc-field-${f.key}`}>
                    <dt className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                      {f.label}
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${c.cls}`}>
                        <c.Icon className="h-3 w-3" aria-hidden="true" />
                        {c.text}
                      </span>
                    </dt>
                    <dd className="mt-0.5 min-h-6 break-words text-base text-slate-950">{f.value || <span className="text-slate-400">—</span>}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ) : null}

        {proposal.items.length ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold">{proposal.itemsLabel} <span className="font-normal text-slate-500">({proposal.items.length + proposal.moreItems})</span></h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="doc-items">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    {proposal.itemColumns.map((c) => (
                      <th key={c.key} className="py-1.5 pr-3 font-semibold">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {proposal.items.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      {proposal.itemColumns.map((c) => (
                        <td key={c.key} className="py-1.5 pr-3">{row[c.key] || <span className="text-slate-300">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {proposal.moreItems ? <p className="mt-2 text-xs text-slate-500">{proposal.moreItems} more lines are on the document.</p> : null}
          </section>
        ) : null}

        <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700" data-testid="doc-next">{proposal.next}</p>
        <Link href="/inbox" className="inline-block rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">
          Back to the inbox
        </Link>
      </div>
    </div>
  );
}
