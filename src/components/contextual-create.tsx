"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CreateOption, CreateResult } from "@/lib/contextual-create";
import { Tip, inputBase } from "./ui";

/** What a "+ Add …" button makes: its dialog's text, the record's fields, and the server action that saves it. */
export type CreateConfig = {
  /** Button text, e.g. "Add strain". */
  buttonLabel: string;
  /** Dialog heading, e.g. "Add a strain". */
  title: string;
  /** One line under the heading, e.g. where else the record will show up. */
  intro?: string;
  /** The record's own fields, with the same names its server function reads. */
  fields?: ReactNode;
  /**
   * For records with many required fields: a guided side drawer that asks for them a step at a time.
   * Each step is checked before moving on, and every step's answers are sent together at the end.
   */
  steps?: { title: string; fields: ReactNode }[];
  action: (formData: FormData) => Promise<CreateResult>;
  submitLabel: string;
};

/** Options in order, bunched by group (ungrouped ones stand alone), for <optgroup>s. */
function groupsOf(options: CreateOption[]): [string | undefined, CreateOption[]][] {
  const out: [string | undefined, CreateOption[]][] = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (last && last[0] === o.group && o.group) last[1].push(o);
    else out.push([o.group, [o]]);
  }
  return out;
}

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
  hint,
  hideLabel,
  compact,
  searchable,
  onCreated,
  onChange,
  className,
}: {
  name: string;
  label: string;
  options: CreateOption[];
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
  create?: CreateConfig;
  deniedHint?: ReactNode;
  /** Help text in an info tip beside the label, like Field's hint. */
  hint?: string;
  /** Keep the label for screen readers only, for compact rows such as a recipe's input lines. */
  hideLabel?: boolean;
  /** An icon-only add button (its name is still read out), for narrow rows. */
  compact?: boolean;
  /** Type to search the list instead of scrolling it. For pickers that can grow long (items, strains, vendors). */
  searchable?: boolean;
  /** Told about every record added here, so sibling pickers on the same form can list it at once. */
  onCreated?: (option: CreateOption) => void;
  /** Told whenever the chosen record changes, by hand or because one was just added. */
  onChange?: (id: string) => void;
  className?: string;
}) {
  // Records added here stay in the list even before the refreshed page sends them back.
  const [added, setAdded] = useState<CreateOption[]>([]);
  const options = useMemo(() => {
    const merged = [...initialOptions];
    for (const o of added) if (!merged.some((m) => m.id === o.id)) merged.push(o);
    return added.length ? merged.sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label)) : merged;
  }, [initialOptions, added]);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Where focus goes once the dialog has closed: the picker after a save, the button after a cancel.
  const focusAfterClose = useRef<"select" | "button" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectId = useId();
  const useSearch = Boolean(searchable);

  const choose = (option: CreateOption) => {
    setAdded((current) => (current.some((o) => o.id === option.id) ? current : [...current, option]));
    setValue(option.id);
    onCreated?.(option);
    onChange?.(option.id);
    focusAfterClose.current = "select";
    setOpen(false);
  };

  // Runs after the dialog's own cleanup (which hands focus back to whatever opened it), so this wins:
  // after a save the employee lands on the picker holding the new record, ready for the next field.
  useEffect(() => {
    if (open || !focusAfterClose.current) return;
    (focusAfterClose.current === "select" ? (useSearch ? searchRef.current : selectRef.current) : buttonRef.current)?.focus();
    focusAfterClose.current = null;
  }, [open]);

  return (
    <div className={className ?? "block"}>
      {hideLabel ? (
        <label htmlFor={selectId} className="sr-only">
          {label}
        </label>
      ) : (
        <span className="mb-1 flex items-center gap-1">
          <label htmlFor={selectId} className="text-sm font-semibold text-slate-800">
            {label}
          </label>
          {hint ? <Tip text={hint} label={`About ${label}`} /> : null}
        </span>
      )}
      <div className="flex gap-2">
        {useSearch ? (
          <SearchBox
            id={selectId}
            inputRef={searchRef}
            options={options}
            value={value}
            required={required}
            placeholder={options.length === 0 ? `None yet${create ? ": add one →" : ""}` : placeholder}
            onPick={(id) => {
              setValue(id);
              onChange?.(id);
            }}
          />
        ) : null}
        <select
          ref={selectRef}
          id={useSearch ? undefined : selectId}
          name={name}
          required={required && !useSearch}
          // While the search box is showing, this stays as the form's real field but out of sight and out of the tab order.
          {...(useSearch ? { className: "sr-only", tabIndex: -1, "aria-hidden": true } : {})}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onChange?.(e.target.value);
          }}
          {...(useSearch ? {} : { className: `${inputBase} w-full flex-1` })}
        >
          <option value="" disabled={required}>
            {options.length === 0 ? `None yet${create ? ": add one →" : ""}` : placeholder}
          </option>
          {groupsOf(options).map(([group, list]) =>
            group ? (
              <optgroup key={group} label={group}>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              list.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))
            ),
          )}
        </select>
        {create ? (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={compact ? create.buttonLabel : undefined}
            title={compact ? create.buttonLabel : undefined}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border-2 border-brand-200 bg-white px-3 text-sm font-bold text-brand-800 hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {compact ? null : create.buttonLabel}
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

/**
 * The add form, drawn outside the parent form. A centred dialog for short records, or a guided side
 * drawer (`steps`) for long ones. On phones both are a bottom sheet.
 */
function CreateDialog({
  title,
  intro,
  fields,
  steps,
  action,
  submitLabel,
  onCreated,
  onCancel,
}: CreateConfig & { onCreated: (option: CreateOption) => void; onCancel: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<CreateOption | null>(null);
  const [confirm, setConfirm] = useState<CreateResult["confirm"] | null>(null);
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const titleId = useId();
  const pages = steps?.length ? steps : [{ title: "", fields }];
  const guided = pages.length > 1 || Boolean(steps?.length);
  const last = step === pages.length - 1;

  const focusFirst = (index: number) =>
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLElement>(`[data-step="${index}"] :is(input:not([type=hidden]), select, textarea)`)
        ?.focus(),
    );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // Start typing in the first box straight away.
    focusFirst(0);
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  /** Checks only the boxes on this step, showing the browser's own message on the first one that's wrong. */
  const stepIsValid = (index: number) => {
    const boxes = formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[data-step="${index}"] :is(input, select, textarea)`,
    );
    for (const box of Array.from(boxes ?? [])) {
      if (!box.checkValidity()) {
        box.reportValidity();
        return false;
      }
    }
    return true;
  };

  const go = (index: number) => {
    setStep(index);
    focusFirst(index);
  };

  const send = (data: FormData) =>
    start(async () => {
      try {
        const result = await action(data);
        if (result.created) return onCreated(result.created);
        setExisting(result.existing ?? null);
        setConfirm(result.confirm ?? null);
        setError(result.existing || result.confirm ? null : (result.error ?? "Could not save. Nothing was changed."));
      } catch {
        setError("Could not reach Leaf2Sale. Check the connection and try again. Nothing was changed.");
      }
    });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    // Handled by hand so a failed save keeps what was typed in the dialog, too.
    event.preventDefault();
    event.stopPropagation();
    if (!stepIsValid(step)) return;
    // Enter on an early step moves on rather than saving half a record.
    if (!last) return go(step + 1);
    setConfirm(null);
    send(new FormData(event.currentTarget));
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="contextual-create"
      data-variant={guided ? "drawer" : "dialog"}
      // Escape closes the dialog; cancelling leaves the task exactly as it was.
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      className={`m-0 mt-auto max-h-[92dvh] w-dvw max-w-dvw overflow-y-auto overflow-x-hidden rounded-t-2xl bg-white p-0 shadow-2xl backdrop:bg-brand-950/50 ${
        guided
          ? "sm:mr-0 sm:ml-auto sm:mt-0 sm:h-dvh sm:max-h-dvh sm:w-[30rem] sm:rounded-none sm:rounded-l-2xl"
          : "sm:m-auto sm:w-[min(92vw,28rem)] sm:rounded-2xl"
      }`}
    >
      <form ref={formRef} onSubmit={submit} className="flex min-h-full flex-col gap-4 p-5">
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

        {guided ? (
          <ol className="flex gap-1.5" aria-label="Steps">
            {pages.map((p, i) => (
              <li key={p.title} className="min-w-0 flex-1" aria-current={i === step ? "step" : undefined}>
                <span className={`block h-1.5 rounded-full ${i <= step ? "bg-brand-600" : "bg-slate-200"}`} />
                <span className={`mt-1 block truncate text-xs ${i === step ? "font-bold text-brand-900" : "text-slate-500"}`}>{p.title}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {guided ? (
          <p className="sr-only" aria-live="polite">
            Step {step + 1} of {pages.length}: {pages[step].title}
          </p>
        ) : null}

        {/* Every step stays in the form (hidden when it isn't current) so all answers are sent together. */}
        {pages.map((p, i) => (
          <fieldset key={p.title || i} data-step={i} hidden={i !== step} className="min-w-0 space-y-4">
            {guided ? <legend className="sr-only">{p.title}</legend> : null}
            {p.fields}
          </fieldset>
        ))}

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
        {confirm ? (
          <div role="alert" className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p className="font-medium">{confirm.message}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!formRef.current) return;
                const data = new FormData(formRef.current);
                data.set("confirm", "1");
                send(data);
              }}
              className="mt-2 inline-flex min-h-10 items-center rounded-md bg-amber-600 px-3 text-sm font-bold text-white hover:bg-amber-700"
            >
              {confirm.label}
            </button>
          </div>
        ) : null}

        <div className="mt-auto flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          {guided && step > 0 ? (
            <button
              type="button"
              onClick={() => go(step - 1)}
              disabled={pending}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 sm:mr-auto"
            >
              Back
            </button>
          ) : null}
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
            {pending ? "Saving…" : last ? submitLabel : "Next"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}


/** Words typed in the box must all appear somewhere in an option's text, in any order. */
function matches(label: string, query: string): boolean {
  const hay = label.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/**
 * A type-to-search list. The picker's own (hidden) <select> stays the form's real field, so the form sends exactly
 * what a <select> would. Typing narrows the list; arrow keys and Enter pick; a typed phrase that was never picked
 * counts as "nothing chosen", so a required field still stops the form.
 */
function SearchBox({
  id,
  inputRef,
  options,
  value,
  required,
  placeholder,
  onPick,
}: {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  options: CreateOption[];
  value: string;
  required?: boolean;
  placeholder: string;
  onPick: (id: string) => void;
}) {
  const chosen = options.find((o) => o.id === value);
  const [text, setText] = useState(chosen?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  // A record picked or added from outside the box (the "+ Add" dialog) shows its name here.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (value) setText(chosen?.label ?? "");
  }

  // After a pick the box holds the full name; show everything again until the person types.
  const searching = open && text !== (chosen?.label ?? "");
  const shown = useMemo(() => (searching ? options.filter((o) => matches(o.label, text)) : options), [options, text, searching]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(value || !text ? "" : "Pick one from the list.");
  }, [value, text, inputRef]);

  const pick = (o: CreateOption) => {
    onPick(o.id);
    setText(o.label);
    setOpen(false);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        required={required}
        value={text}
        placeholder={placeholder}
        // The list opens when the person clicks, types or presses ArrowDown, not on focus alone: focus also
        // lands here by itself after "+ Add" saves, and an open list there would cover the fields below.
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          if (value) onPick("");
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          if (chosen) setText(chosen.label);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className={`${inputBase} w-full`}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">Nothing matches.</li>
          ) : (
            shown.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === value}
                // mousedown, so the pick lands before the box loses focus and closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-brand-50 text-brand-900" : "text-slate-800"} ${o.id === value ? "font-semibold" : ""}`}
              >
                {o.group ? <span className="mr-2 text-xs text-slate-500">{o.group}</span> : null}
                {o.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
