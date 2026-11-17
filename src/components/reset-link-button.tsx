"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useActionState, useState } from "react";

type State = { error?: string; ok?: string; link?: string } | null;

/** Make a one-time password reset link for a team member, and copy it to send them. */
export function ResetLinkButton({ userId, name, action }: { userId: string; name: string; action: (state: State, form: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="w-full">
      <form action={formAction} onSubmit={() => setCopied(false)}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border-2 border-brand-200 bg-white px-4 text-sm font-bold text-brand-800 hover:border-brand-500 hover:bg-brand-50 disabled:opacity-60"
          aria-label={`Make a password reset link for ${name}`}
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" /> {pending ? "Working…" : "Reset password"}
        </button>
      </form>
      {state?.error ? (
        <p role="alert" className="mt-2 rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          {state.error}
        </p>
      ) : null}
      {state?.link ? (
        <div className="mt-2 space-y-2 rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 text-sm text-brand-900" role="status">
          <p className="font-medium">{state.ok}</p>
          <div className="flex gap-2">
            <input readOnly value={state.link} aria-label={`Reset link for ${name}`} className="min-w-0 flex-1 rounded-md border border-brand-200 bg-white px-2 py-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(state.link!).then(() => setCopied(true))}
              className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-2.5 text-xs font-bold text-white hover:bg-brand-800"
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
