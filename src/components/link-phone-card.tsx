"use client";

import { useState, useTransition } from "react";
import { makePairingAction } from "@/app/(app)/account/actions";

/** Shows a QR code for linking a phone. Scanning it with the phone's camera opens Leaf2Sale there. */
export function LinkPhoneCard() {
  const [link, setLink] = useState<{ url: string; svg: string; minutes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        data-testid="show-qr"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await makePairingAction();
            if (r.error || !r.url || !r.svg) setError(r.error ?? "Could not make a code.");
            else setLink({ url: r.url, svg: r.svg, minutes: r.minutes ?? 10 });
          })
        }
        className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {link ? "Make a new code" : "Link a phone"}
      </button>
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
      {link ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-56 w-56 rounded-lg border border-slate-200 bg-white p-1" data-testid="qr" dangerouslySetInnerHTML={{ __html: link.svg }} />
          <ol className="max-w-xs list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Open the phone&apos;s camera and point it at this code.</li>
            <li>Tap the link, then &quot;Link this phone&quot;.</li>
            <li>Add the page to the home screen so it opens straight to the camera.</li>
            <li className="list-none pl-0 text-xs text-slate-500">The code works once and expires in {link.minutes} minutes.</li>
          </ol>
          <input type="hidden" readOnly value={link.url} data-testid="pair-url" />
        </div>
      ) : null}
    </div>
  );
}
