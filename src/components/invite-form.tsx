"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useState } from "react";
import type { InviteState } from "@/app/(app)/team/actions";
import { Field, inputClass } from "@/components/ui";

export type RoleOption = { value: string; label: string };

/** Invite form that shows the one-time link with a copy button. The link cannot be shown again later. */
export function InviteForm({
  action,
  builtIn,
  custom,
}: {
  action: (state: InviteState, formData: FormData) => Promise<InviteState>;
  builtIn: RoleOption[];
  custom: RoleOption[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  // Remembered between invites: React resets a submitted form, which would quietly put the next invite back on Read-only.
  const [role, setRole] = useState("builtin:READ_ONLY");
  return (
    <form action={formAction} className="space-y-4" onSubmit={() => setCopied(false)}>
      <Field label="Their email">
        <input name="email" type="email" required autoComplete="off" className={inputClass} />
      </Field>
      <Field label="Role">
        <select name="role" required value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
          <optgroup label="Built-in roles">
            {builtIn.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          {custom.length ? (
            <optgroup label="Your roles">
              {custom.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </Field>
      {state?.error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      {state?.ok && state.link ? (
        <div role="status" className="space-y-2 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
          <p>{state.ok}</p>
          <div className="flex gap-2">
            <input readOnly value={state.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-xs`} />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.link!);
                setCopied(true);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {pending ? "Working…" : "Create invite link"}
      </button>
    </form>
  );
}
