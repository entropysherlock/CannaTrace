"use client";

import { useEffect, useRef, useState } from "react";
import { addInputAction, cancelRunAction, completeRunAction } from "@/app/(app)/manufacturing/actions";
import { ActionForm } from "./action-form";
import { ScanInput } from "./scan-input";
import { Field, inputClass } from "./ui";

type Room = { id: string; name: string };

const STEPS = [
  { short: "Add inputs", title: "Add the inputs", info: "Scan or type each package you used and how much. It leaves that package right away." },
  { short: "Finish", title: "Finish the run", info: "Enter how much you made and where it goes. The new package, its cost and its history are created for you." },
] as const;

/** The run, one short form at a time: add inputs until every line is done, then finish. */
export function RunGuide({ runId, unit, planned, rooms, toGo, inputCount, canCancel }: { runId: string; unit: string; planned: string; rooms: Room[]; toGo: number; inputCount: number; canCancel: boolean }) {
  const [step, setStep] = useState(inputCount > 0 && toGo === 0 ? 1 : 0);
  const [saved, setSaved] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const form = (e as CustomEvent<HTMLElement | null>).detail;
      if (form && panel.current?.contains(form)) setSaved(true);
    };
    window.addEventListener("ct:form-saved", onSaved);
    return () => window.removeEventListener("ct:form-saved", onSaved);
  }, []);

  const go = (i: number) => {
    setStep(i);
    setSaved(false);
  };
  const hidden = <input type="hidden" name="runId" value={runId} />;
  const s = STEPS[step];

  return (
    <div className="space-y-4" data-testid="run-guide">
      <nav aria-label="Run steps" className="flex flex-wrap gap-2">
        {STEPS.map((x, i) => (
          <button
            key={x.short}
            type="button"
            onClick={() => go(i)}
            aria-current={i === step ? "step" : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${i === step ? "border-brand-800 bg-brand-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-brand-50"}`}
          >
            {i + 1}. {x.short}
            {i === 0 && toGo > 0 ? <span className={`rounded-full px-2 text-xs font-bold ${i === step ? "bg-white/25" : "bg-amber-100 text-amber-900"}`}>{toGo} to go</span> : null}
          </button>
        ))}
      </nav>

      <div ref={panel} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-bold" data-testid="run-title">{s.title}</h2>
          <span className="text-sm text-slate-500">Step {step + 1} of {STEPS.length}</span>
        </div>
        <p className="mb-4 mt-1 text-sm text-slate-600">{s.info}</p>

        <div hidden={step !== 0}>
          <ActionForm action={addInputAction} submitLabel="Add to run">
            {hidden}
            <Field label="Package tag">
              <ScanInput name="tag" required />
            </Field>
            <Field label="Quantity used" hint="In the package's unit. It leaves the package right away.">
              <input name="quantity" inputMode="decimal" required className={inputClass} />
            </Field>
          </ActionForm>
        </div>

        <div hidden={step !== 1}>
          {toGo > 0 ? (
            <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{toGo} recipe line{toGo === 1 ? " still needs" : "s still need"} inputs. You can finish anyway, but it will be refused if something is missing.</p>
          ) : null}
          <ActionForm action={completeRunAction} submitLabel="Complete run">
            {hidden}
            <Field label={`How much was made (${unit})`} hint={`The plan was ${planned}.`}>
              <input name="actualQuantity" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="Put away to">
              <select name="locationId" required defaultValue="" className={inputClass}>
                <option value="" disabled>Choose a location</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Tag for the finished package (optional)" hint="Blank = a new unique ID is made for you. Or scan or type a state tag.">
              <ScanInput name="outputTag" placeholder="Blank = new PKG- ID" />
            </Field>
            <details className="rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-bold text-slate-800">Labor cost or a note (optional)</summary>
              <div className="mt-3 space-y-3">
                <Field label="Labor and other cost, in dollars" hint="Added to the input cost before working out cost per unit.">
                  <input name="extraCost" inputMode="decimal" className={inputClass} />
                </Field>
                <Field label="Note on loss or problems">
                  <input name="lossNote" maxLength={500} className={inputClass} />
                </Field>
              </div>
            </details>
          </ActionForm>
        </div>
      </div>

      {saved && step === 0 ? (
        <div role="status" className="rounded-2xl border border-brand-200 bg-brand-50 p-4" data-testid="run-next">
          <p className="font-bold text-brand-900">{toGo > 1 ? "Added. Keep adding until every line on the left says done." : "Added. When every line says done, go to Finish."}</p>
          <button type="button" onClick={() => go(1)} className="mt-3 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800" data-testid="run-continue">
            Continue to finish
          </button>
        </div>
      ) : null}

      {canCancel ? (
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Cancel this run</summary>
          <div className="mt-3">
            <ActionForm action={cancelRunAction} submitLabel="Cancel run" quiet>
              {hidden}
              <p className="text-sm text-slate-600">Only an empty run can be cancelled. Remove its inputs first so the product goes back.</p>
            </ActionForm>
          </div>
        </details>
      ) : null}
    </div>
  );
}
