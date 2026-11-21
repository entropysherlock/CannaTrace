"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

/** Something went wrong while loading a page: say so plainly and offer a way on, instead of a blank error. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);
  return (
    <section className="mx-auto max-w-xl py-12 text-center" role="alert">
      <p className="text-sm font-semibold uppercase tracking-wide text-red-700">Something went wrong</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-slate-900">This page didn&apos;t load</h1>
      <p className="mt-3 text-slate-600">Nothing you saved was lost. Try again, or go back to the dashboard.</p>
      {digest ? <p className="mt-2 text-xs text-slate-500">Reference for support: {digest}</p> : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => retry()} className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
          Try again
        </button>
        <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-5 font-semibold text-slate-700 hover:bg-slate-50">
          Go to the dashboard
        </Link>
      </div>
    </section>
  );
}
