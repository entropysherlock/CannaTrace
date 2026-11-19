import Link from "next/link";

/** For addresses that don't match any page at all. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Page not found</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">There&apos;s no page at this address</h1>
      <p className="mt-3 max-w-md text-slate-600">Check the link, or start again from the dashboard.</p>
      <Link href="/dashboard" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
        Go to the dashboard
      </Link>
    </main>
  );
}
