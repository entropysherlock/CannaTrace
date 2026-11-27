"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** A read-only box with a Copy button, for an address someone has to paste into another app. */
export function CopyText({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 font-mono text-sm text-slate-800" />
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true), () => setCopied(false))}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800"
      >
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
