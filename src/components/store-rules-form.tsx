"use client";

import { Info, Wand2 } from "lucide-react";
import { useState } from "react";
import { retailSettingsAction } from "@/app/(app)/pos/actions";
import { ActionForm } from "@/components/action-form";
import { Field, inputBase, inputClass } from "@/components/ui";

export type StatePrefill = {
  state: string;
  name: string;
  flower: string | null;
  concentrate: string | null;
  edible: string | null;
  combined: string | null;
  perDay: boolean;
  summary: string;
  citation: string;
  url: string;
  checked: string;
};

type Values = { flower: string; concentrate: string; edible: string; excise: string; sales: string };

/** Store rules, with a one-click fill of the purchase limits from the chosen state's rule pack. */
export function StoreRulesForm({
  initial,
  medicalTaxExempt,
  prefills,
  facilityState,
}: {
  initial: Values;
  medicalTaxExempt: boolean;
  prefills: StatePrefill[];
  facilityState: string;
}) {
  const [values, setValues] = useState(initial);
  const [state, setState] = useState(prefills.some((p) => p.state === facilityState) ? facilityState : (prefills[0]?.state ?? ""));
  const [filled, setFilled] = useState<StatePrefill | null>(null);
  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const fill = () => {
    const p = prefills.find((x) => x.state === state);
    if (!p) return;
    setValues((v) => ({
      ...v,
      flower: p.flower ?? v.flower,
      concentrate: p.concentrate ?? v.concentrate,
      edible: p.edible ?? v.edible,
    }));
    setFilled(p);
  };

  const missing = filled ? (["flower", "concentrate", "edible"] as const).filter((k) => filled[k] === null) : [];
  const NAMES = { flower: "flower", concentrate: "concentrate", edible: "edibles" };

  return (
    <ActionForm action={retailSettingsAction} submitLabel="Save store rules">
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
        <p className="text-sm font-semibold text-brand-950">Fill in from state rules</p>
        <div className="mt-2 flex gap-2">
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State for purchase limits" className={`${inputBase} min-w-0 flex-1`}>
            {prefills.map((p) => (
              <option key={p.state} value={p.state}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={fill} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-brand-700 px-3 text-sm font-bold text-white hover:bg-brand-800">
            <Wand2 className="h-4 w-4" aria-hidden="true" /> Fill in
          </button>
        </div>
        {filled ? (
          <div role="status" className="mt-2 space-y-1 text-xs text-brand-950">
            <p>
              Filled from {filled.name} adult-use law: {filled.summary}{" "}
              <a href={filled.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                {filled.citation}
              </a>{" "}
              (checked {filled.checked}).
            </p>
            {filled.combined ? <p>{filled.name} also caps flower and concentrate together at {filled.combined} g; the register enforces that automatically.</p> : null}
            {filled.perDay ? <p>{filled.name}&apos;s limit is per day. The register enforces it per sale.</p> : null}
            {missing.length ? (
              <p className="font-semibold">
                {filled.name} doesn&apos;t set a separate limit for {missing.map((k) => NAMES[k]).join(" or ")}. Enter your store&apos;s own number for{" "}
                {missing.length === 1 ? "it" : "them"}.
              </p>
            ) : null}
            <p>Review the numbers, add your tax rates, then press Save store rules.</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-brand-900">Fills in the purchase limits from CannaTrace&apos;s rules for that state, with the regulation they come from.</p>
        )}
      </div>
      <Field label="Flower limit per purchase, in grams">
        <input name="flowerLimitGrams" inputMode="decimal" required value={values.flower} onChange={set("flower")} className={inputClass} />
      </Field>
      <Field label="Concentrate limit per purchase, in grams">
        <input name="concentrateLimitGrams" inputMode="decimal" required value={values.concentrate} onChange={set("concentrate")} className={inputClass} />
      </Field>
      <Field label="Edible limit per purchase, in milligrams of THC">
        <input name="edibleLimitMg" inputMode="decimal" required value={values.edible} onChange={set("edible")} className={inputClass} />
      </Field>
      <p className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Tax rates depend on your city and county as well as the state, so enter the rates on your latest tax filing.</span>
      </p>
      <Field label="Cannabis excise tax, percent">
        <input name="exciseTaxPercent" inputMode="decimal" required value={values.excise} onChange={set("excise")} className={inputClass} />
      </Field>
      <Field label="Sales tax, percent">
        <input name="salesTaxPercent" inputMode="decimal" required value={values.sales} onChange={set("sales")} className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="medicalTaxExempt" defaultChecked={medicalTaxExempt} className="h-5 w-5 accent-brand-700" />
        Medical patients pay no tax
      </label>
    </ActionForm>
  );
}
