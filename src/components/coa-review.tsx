"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, FileWarning, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { confirmCoaAction, dismissScanAction, type ConfirmResult } from "@/app/(app)/inbox/actions";
import { type CoaField, type CoaProposal, type CoaValues, type Confidence, type PackageMatch } from "@/lib/scan/types";

const LABEL: Record<CoaField, string> = {
  labName: "Testing lab",
  sampleDate: "Sample date",
  result: "Result",
  thcPercent: "Total THC %",
  cbdPercent: "CBD %",
  thcaPercent: "THCa %",
  d9ThcPercent: "Δ9-THC %",
  cbdaPercent: "CBDa %",
  totalCbdPercent: "Total CBD %",
  cbgPercent: "CBG %",
  cbnPercent: "CBN %",
  totalCannabinoidsPercent: "Total cannabinoids %",
  terpenes: "Terpenes",
  notes: "Notes",
};
const MAIN: CoaField[] = ["labName", "sampleDate", "thcPercent", "cbdPercent"];
const MORE: CoaField[] = ["thcaPercent", "d9ThcPercent", "cbdaPercent", "cbgPercent", "cbnPercent", "totalCannabinoidsPercent"];

const CHIP: Record<Confidence, { text: string; cls: string }> = {
  ok: { text: "Read from the document", cls: "text-brand-700" },
  check: { text: "Check this one", cls: "text-amber-700" },
  missing: { text: "Not found", cls: "text-slate-500" },
};
const ring = (c: Confidence) => (c === "check" ? "border-amber-400 bg-amber-50/60" : c === "missing" ? "border-slate-300 bg-white" : "border-brand-200 bg-white");

function Chip({ c }: { c: Confidence }) {
  const Icon = c === "ok" ? CheckCircle2 : c === "check" ? AlertTriangle : CircleDashed;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${CHIP[c].cls}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {CHIP[c].text}
    </span>
  );
}

export function CoaReview({
  attachmentId,
  name,
  isPdf,
  proposal,
  matches: initial,
}: {
  attachmentId: string;
  name: string;
  isPdf: boolean;
  proposal: CoaProposal;
  matches: PackageMatch[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<CoaValues>(proposal.values);
  const [touched, setTouched] = useState<Set<CoaField>>(new Set());
  const [matches, setMatches] = useState(initial);
  const [picked, setPicked] = useState<string>(initial[0] && initial[0].score >= 60 ? initial[0].id : "");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<ConfirmResult, { ok: true }> | null>(null);
  const [pending, start] = useTransition();
  const src = `/api/assistant/attachments/${attachmentId}`;

  useEffect(() => {
    if (search.trim().length < 2) return;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/scan/packages?q=${encodeURIComponent(search.trim())}`);
        const data = await res.json();
        if (res.ok) setMatches(data.matches);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  const conf = (f: CoaField): Confidence => (touched.has(f) && values[f] ? "ok" : proposal.confidence[f]);
  const set = (f: CoaField, v: string) => {
    setValues((all) => ({ ...all, [f]: v }));
    setTouched((all) => new Set(all).add(f));
  };
  const chosen = matches.find((m) => m.id === picked);
  const ready = Boolean(picked && values.labName.trim() && values.result);

  const confirm = () =>
    start(async () => {
      setError(null);
      const r = await confirmCoaAction({ attachmentId, packageId: picked, values });
      if (r.ok) setDone(r);
      else setError(r.error);
    });

  if (done)
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-brand-200 bg-white p-8 text-center shadow-sm" data-testid="scan-done">
        <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" aria-hidden="true" />
        <h2 className="mt-3 font-display text-2xl font-bold">Saved to {chosen?.tag}</h2>
        <p className="mt-1 text-slate-600">The lab result and the certificate are on the package.</p>
        {done.quarantined ? (
          <p role="status" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">A failed result puts the package in quarantine automatically. It can&apos;t be sold or moved until it is released.</p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href={`/inventory/${done.packageId}`} className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">Open the package</Link>
          <Link href="/inbox" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Back to the inbox</Link>
        </div>
      </div>
    );

  const field = (f: CoaField) => (
    <label key={f} className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
        {LABEL[f]}
        <Chip c={conf(f)} />
      </span>
      <input
        value={values[f]}
        onChange={(e) => set(f, e.target.value)}
        type={f === "sampleDate" ? "date" : "text"}
        inputMode={f.endsWith("Percent") ? "decimal" : undefined}
        data-testid={`field-${f}`}
        className={`h-11 w-full rounded-lg border px-3 text-base ${ring(conf(f))}`}
      />
    </label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="coa-review">
      <div className="lg:sticky lg:top-4 lg:self-start">
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
        <p className="mt-2 truncate text-xs text-slate-500">{name}</p>
      </div>

      <div className="space-y-5 pb-28">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-bold">Which package is this for?</h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by tag or product name" aria-label="Search packages" className="h-11 w-full rounded-lg border border-slate-300 pl-9 pr-9 text-base" />
            {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" aria-hidden="true" /> : null}
          </div>
          {matches.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600" data-testid="no-match">No package matches yet. {proposal.identifiers.product ? `The certificate says "${proposal.identifiers.product}". ` : ""}Search for the package above.</p>
          ) : (
            <ul className="mt-3 space-y-2" role="radiogroup" aria-label="Package">
              {matches.map((m, i) => (
                <li key={m.id}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${picked === m.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <input type="radio" name="package" checked={picked === m.id} onChange={() => setPicked(m.id)} className="mt-1 h-4 w-4 accent-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold">{m.tag}</span>
                        {i === 0 && m.score >= 60 ? <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Best match</span> : null}
                      </span>
                      <span className="block truncate text-sm text-slate-700">{m.itemName} · {m.quantity} {m.unit}</span>
                      <span className="block text-xs text-slate-500">{m.reasons.join(" · ")}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-bold">What the certificate says</h2>
          <fieldset className="mt-3">
            <legend className="mb-1 flex w-full items-center justify-between text-sm font-semibold text-slate-800">Result <Chip c={conf("result")} /></legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Result">
              {(["PASS", "FAIL", "PENDING"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={values.result === r}
                  data-testid={`result-${r}`}
                  onClick={() => set("result", r)}
                  className={`h-11 rounded-lg border text-sm font-bold ${values.result === r ? (r === "FAIL" ? "border-red-600 bg-red-600 text-white" : "border-brand-700 bg-brand-700 text-white") : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {r === "PASS" ? "Pass" : r === "FAIL" ? "Fail" : "Pending"}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">{MAIN.map(field)}</div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-bold text-brand-800">Full cannabinoid profile and terpenes</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">{MORE.map(field)}</div>
            <div className="mt-4 space-y-4">{field("terpenes")}{field("notes")}</div>
          </details>
        </section>

        {proposal.warnings.length > 0 ? (
          <section role="note" className="rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="warnings">
            <h3 className="flex items-center gap-2 text-sm font-bold text-amber-900"><FileWarning className="h-4 w-4" aria-hidden="true" /> Worth a second look</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </section>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-slate-600">
            {error ? <span role="alert" className="font-semibold text-red-700">{error}</span> : chosen ? <>Saving to <strong className="font-mono">{chosen.tag}</strong>, {chosen.itemName}</> : "Choose the package to save this to."}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => start(async () => { await dismissScanAction(attachmentId); router.push("/inbox"); })} className="h-11 rounded-lg border border-slate-300 px-4 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">Skip</button>
            <button type="button" disabled={!ready || pending} onClick={confirm} data-testid="confirm-coa" className="h-11 rounded-lg bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
              {pending ? "Saving…" : "Confirm and save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
