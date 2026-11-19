"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CreateOption, CreateResult } from "@/lib/contextual-create";
import { inputBase } from "./ui";

/**
 * A dropdown with a "+ Add …" button beside it, for when the record an employee needs isn't there yet.
 *
 * The add form opens in a dialog on top of the current task, so nothing the employee already typed is lost:
 * the dialog is rendered outside the parent form (no nested forms), the parent's fields are never reset,
 * and only this picker's value changes, to the record just made. Saving goes through the same server
 * function, validation, permission check, and audit log as the record's own page.
 *
 * Without permission to create (`create` left out), the picker shows `deniedHint` instead of a button.
 */
export function CreatableSelect({
  name,
  label,
  options: initialOptions,
  placeholder,
  required,
  defaultValue = "",
  create,
  deniedHint,
}: {
  name: string;
  label: string;
  options: CreateOption[];
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
  create?: {
    /** Button text, e.g. "Add strain". */
    buttonLabel: string;
    /** Dialog heading, e.g. "Add a strain". */
    title: string;
    /** One line under the heading, e.g. where else the record will show up. */
    intro?: string;
    /** The record's own fields, with the same names its server function reads. */
    fields: ReactNode;
    action: (formData: FormData) => Promise<CreateResult>;
    submitLabel: string;
  };
  deniedHint?: ReactNode;
}) {
  // Records added here stay in the list even before the refreshed page sends them back.
  const [added, setAdded] = useState<CreateOption[]>([]);
  const options = useMemo(() => {
    const merged = [...initialOptions];
    for (const o of added) if (!merged.some((m) => m.id === o.id)) merged.push(o);
    return added.length ? merged.sort((a, b) => a.label.localeCompare(b.label)) : merged;
  }, [initialOptions, added]);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  // Where focus goes once the dialog has closed: the picker after a save, the button after a cancel.
  const focusAfterClose = useRef<"select" | "button" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectId = useId();

  const choose = (option: CreateOption) => {
    setAdded((current) => (current.some((o) => o.id === option.id) ? current : [...current, option]));
    setValue(option.id);
    focusAfterClose.current = "select";
    setOpen(false);
  };

  // Runs after the dialog's own cleanup (which hands focus back to whatever opened it), so this wins:
  // after a save the employee lands on the picker holding the new record, ready for the next field.
  useEffect(() => {
    if (open || !focusAfterClose.current) return;
    (focusAfterClose.current === "select" ? selectRef.current : buttonRef.current)?.focus();
    focusAfterClose.current = null;
  }, [open]);

  return (
    <div className="block">
      <label htmlFor={selectId} className="mb-1 flex items-center gap-1 text-sm font-semibold text-slate-800">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          ref={selectRef}
          id={selectId}
          name={name}
          required={required}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`${inputBase} w-full flex-1`}
        >
          <option value="" disabled={required}>
            {options.length === 0 ? `None yet${create ? ": add one →" : ""}` : placeholder}
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {create ? (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border-2 border-brand-200 bg-white px-3 text-sm font-bold text-brand-800 hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {create.buttonLabel}
          </button>
        ) : null}
      </div>
      {!create && deniedHint ? <p className="mt-1 text-xs text-slate-600">{deniedHint}</p> : null}
      {create && open ? (
        <CreateDialog
          {...create}
          onCreated={choose}
          onCancel={() => {
            focusAfterClose.current = "button";
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** The add form, in a modal dialog drawn outside the parent form. A bottom sheet on phones. */
function CreateDialog({
  title,
  intro,
  fields,
  action,
  submitLabel,
  onCreated,
  onCancel,
}: {
  title: string;
  intro?: string;
  fields: ReactNode;
  action: (formData: FormData) => Promise<CreateResult>;
  submitLabel: string;
  onCreated: (option: CreateOption) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<CreateOption | null>(null);
  const [pending, start] = useTransition();
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // Start typing in the first box straight away.
    dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    // Handled by hand so a failed save keeps what was typed in the dialog, too.
    event.preventDefault();
    event.stopPropagation();
    const data = new FormData(event.currentTarget);
    start(async () => {
      try {
        const result = await action(data);
        if (result.created) return onCreated(result.created);
        setExisting(result.existing ?? null);
        setError(result.existing ? null : (result.error ?? "Could not save. Nothing was changed."));
      } catch {
        setError("Could not reach CannaTrace. Check the connection and try again. Nothing was changed.");
      }
    });
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="contextual-create"
      // Escape closes the dialog; cancelling leaves the task exactly as it was.
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 shadow-2xl backdrop:bg-brand-950/50 sm:m-auto sm:w-[min(92vw,28rem)] sm:rounded-2xl"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-brand-950">
              {title}
            </h2>
            {intro ? <p className="mt-0.5 text-sm text-slate-600">{intro}</p> : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            aria-label="Close without saving"
            className="-mr-2 -mt-1 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {fields}
        {error ? (
          <p role="alert" className="whitespace-pre-line rounded-lg border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
            {error}
          </p>
        ) : null}
        {existing ? (
          <div role="alert" className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p className="font-medium">
              <strong>{existing.label}</strong> already exists, so nothing new was added.
            </p>
            <button
              type="button"
              onClick={() => onCreated(existing)}
              className="mt-2 inline-flex min-h-10 items-center rounded-md bg-amber-600 px-3 text-sm font-bold text-white hover:bg-amber-700"
            >
              Use {existing.label}
            </button>
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
