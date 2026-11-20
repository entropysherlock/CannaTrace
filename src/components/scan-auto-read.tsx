"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Starts reading a document the moment its page opens, then shows the result. */
export function ScanAutoRead({ attachmentId }: { attachmentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/scan/${attachmentId}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "That document couldn't be read.");
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [attachmentId, router]);
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-brand-100 bg-white p-8 text-center" data-testid="reading">
      {error ? (
        <>
          <p role="alert" className="max-w-md font-semibold text-red-700">{error}</p>
          <button type="button" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white" onClick={() => { started.current = false; setError(null); router.refresh(); }}>
            Try again
          </button>
        </>
      ) : (
        <>
          <Sparkles className="h-8 w-8 animate-pulse text-brand-600" aria-hidden="true" />
          <p className="text-lg font-bold">Reading your document…</p>
          <p className="max-w-sm text-sm text-slate-600">Tally is pulling out the lab, the dates, and every cannabinoid. You will check it before anything is saved.</p>
        </>
      )}
    </div>
  );
}
