import Link from "next/link";

/** Shown inside the app when a link points at a record that doesn't exist here. */
export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl py-12 text-center" data-testid="not-found">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Not found</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">We couldn&apos;t find that here</h1>
      <p className="mt-3 text-slate-600">
        The link may be old, the record may have been removed, or it may belong to another facility. If you work at more than one, switch facility at the
        top of the page and try again.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
          Go to the dashboard
        </Link>
        <Link href="/search" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-5 font-semibold text-slate-700 hover:bg-slate-50">
          Search
        </Link>
      </div>
    </section>
  );
}
