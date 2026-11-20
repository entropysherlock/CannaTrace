"use client";

import { useState } from "react";
import { Field, inputClass } from "./ui";

type Option = { id: string; name: string };

/** Picks what to do with the checked packages and shows only the boxes that action needs. */
export function PackageBulkFields({ locations, canWrite, canPrint }: { locations: Option[]; canWrite: boolean; canPrint: boolean }) {
  const [action, setAction] = useState("");
  const status = action === "ON_HOLD" || action === "QUARANTINE" || action === "ACTIVE";
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="package-bulk">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-slate-900">With the checked packages</p>
        <button
          type="button"
          className="text-sm font-semibold text-brand-700 hover:underline"
          onClick={(event) => {
            const boxes = event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="packageId"]') ?? [];
            const allTicked = Array.from(boxes).every((box) => box.checked);
            boxes.forEach((box) => (box.checked = !allTicked));
            // Let the Print labels button count the change.
            event.currentTarget.form?.dispatchEvent(new Event("change", { bubbles: true }));
          }}
        >
          Check or uncheck all
        </button>
      </div>
      <select name="bulkAction" required value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" className={inputClass}>
        <option value="" disabled>
          Choose what to do
        </option>
        {canWrite ? (
          <>
            <option value="MOVE">Move to another location</option>
            <option value="ON_HOLD">Put on hold</option>
            <option value="QUARANTINE">Put in quarantine</option>
            <option value="ACTIVE">Release (make active again)</option>
          </>
        ) : null}
        {canPrint ? <option value="LABELS">Print labels</option> : null}
      </select>

      {action === "MOVE" ? (
        <>
          <Field label="Move to">
            <select name="toLocationId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Choose a location
              </option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input name="note" maxLength={300} className={inputClass} />
          </Field>
        </>
      ) : null}

      {status ? (
        <Field label="Reason" hint="Required. Saved in the audit trail for each package.">
          <input name="reason" required maxLength={300} className={inputClass} />
        </Field>
      ) : null}

      {action === "LABELS" ? <p className="text-sm text-slate-600">Opens SmartLabel with the checked packages chosen, up to 1,000 at a time.</p> : null}
      {action && action !== "LABELS" ? (
        <p className="text-xs text-slate-500">All or nothing: if any checked package can&apos;t be changed, none are, and the message says which one.</p>
      ) : null}
    </div>
  );
}
