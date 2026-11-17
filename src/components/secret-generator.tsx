"use client";

import { useState } from "react";

/** Makes a random 32-byte secret in this browser (it never goes to the server) for pasting into Vercel. */
export function SecretGenerator() {
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const make = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    setValue(btoa(String.fromCharCode(...bytes)));
    setCopied("no");
  };
  return (
    <div className="space-y-2">
      <button type="button" onClick={make} className="min-h-10 rounded-lg bg-brand-700 px-3 text-sm font-bold text-white hover:bg-brand-800">
        Generate a value
      </button>
      {value ? (
        <div className="flex gap-2">
          <input readOnly value={value} aria-label="Generated secret" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 font-mono text-xs" />
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(value).then(
                () => setCopied("yes"),
                () => setCopied("failed"),
              )
            }
            className="min-h-10 rounded-lg px-3 text-sm font-semibold text-brand-700 ring-1 ring-brand-200"
          >
            {copied === "yes" ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      {copied === "yes" ? <p className="text-xs font-semibold text-brand-800">Copied. It is 44 characters long and ends with =.</p> : null}
      {copied === "failed" ? (
        <p role="alert" className="text-xs font-semibold text-red-800">
          Your browser blocked copying. Click in the box above, press Ctrl+A then Ctrl+C to copy it yourself.
        </p>
      ) : null}
    </div>
  );
}
