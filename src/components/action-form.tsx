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
    if (!state?.ok) return;
    formRef.current?.reset();
    // Lets a "Show me how" walkthrough move on once the step's form has saved.
    window.dispatchEvent(new CustomEvent("ct:form-saved", { detail: formRef.current }));
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
        <p role="alert" className="whitespace-pre-line rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="whitespace-pre-line break-all rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
          {state.ok}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-bold shadow-sm transition disabled:opacity-60 ${
          quiet ? "border-2 border-brand-200 bg-white text-brand-800 hover:border-brand-500 hover:bg-brand-50" : "bg-brand-600 text-white hover:bg-brand-700"
        }`}
      >
        {pending ? "Working…" : submitLabel}
      </button>
    </form>
  );
}
