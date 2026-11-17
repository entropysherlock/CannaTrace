"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** After payment: the change to hand back, big, and one button (or Enter) for the next customer. */
export function NextCustomer({ total, change, number }: { total: string; change: string | null; number: string }) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <div className="mx-auto mb-5 flex max-w-3xl flex-wrap items-center gap-5 rounded-3xl bg-brand-950 p-6 text-white print:hidden" role="status">
      <CheckCircle2 className="h-12 w-12 shrink-0 text-brand-200" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-200">
          Sale {number} complete · {total}
        </p>
        <p className="font-display text-4xl font-bold tabular-nums tracking-tight">{change ? `Change due ${change}` : "No change due"}</p>
      </div>
      <button
        ref={button}
        type="button"
        onClick={() => router.push("/pos")}
        className="h-16 rounded-2xl bg-white px-8 text-xl font-bold text-brand-950 hover:bg-brand-50 focus-visible:outline-4 focus-visible:outline-brand-200"
      >
        Next customer
      </button>
    </div>
  );
}
