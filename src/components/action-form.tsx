"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/lib/form";

export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  quiet,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  className?: string;
  /** A plain outlined button, for undoing or cancelling rather than moving forward. */
  quiet?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form only after a success, so nobody has to retype after an error.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        // Submitting by hand keeps what was typed when the server reports a problem.
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={className ?? "space-y-4"}
    >
      {children}
      {state?.error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.ok}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold disabled:opacity-60 ${
          quiet ? "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50" : "bg-emerald-700 text-white hover:bg-emerald-800"
        }`}
      >
        {pending ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
