"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dryWeightAction, finishHarvestAction, packageHarvestAction, quickStrainAction, tagPlantsAction, wasteAction } from "@/app/(app)/cultivation/actions";
import { growBatchAction, growHarvestAction, growMoveAction } from "@/app/(app)/cultivation/grow-actions";
import { quickRoomAction } from "@/app/(app)/quick-create-actions";
import { ActionForm } from "./action-form";
import { CreatableSelect } from "./contextual-create";
import { StrainFields, WeightInput } from "./cultivation-ui";
import { RoomFields } from "./quick-fields";
import { Field, inputClass } from "./ui";

type Opt = { id: string; name: string };
export type GrowData = {
  canAddRoom: boolean;
  strains: Opt[];
  rooms: Opt[];
  items: { id: string; label: string }[];
  untaggedBatches: { id: string; name: string; strain: string; untagged: number; roomId: string }[];
  plantGroups: { key: string; label: string; phase: string; ids: string[] }[];
  dryingHarvests: { id: string; label: string; day: number; ready: boolean }[];
  packableHarvests: { id: string; label: string; left: string }[];
  finishable: { id: string; label: string }[];
  counts: { untagged: number; plants: number; flowering: number; toDry: number; waiting: number; toPackage: number };
  suggested: number;
};

const STEPS = [
  { short: "Start", title: "Start a batch", info: "Pick the strain and how many plants. The batch name fills itself in." },
  { short: "Tag", title: "Tag your plants", info: "Leave the first tag blank to use the next tags in order, or scan or type your own." },
  { short: "Move", title: "Move or change stage", info: "Tick the plants, then say where they go or what stage they are in. Do both in one go if you like." },
  { short: "Harvest", title: "Harvest", info: "Tick the flowering plants you cut, enter the wet weight, and pick the room where they will dry." },
  { short: "Dry", title: "Dry weight", info: "When the harvest is dry, weigh it and enter the weight here. Log any waste below." },
  { short: "Package", title: "Package", info: "Choose the item and weight. Packages are created and ready to label." },
] as const;

const NEXT: Record<number, string> = {
  0: "Next: tag the plants. Tags are ready, just confirm.",
  1: "Next: move them to the flower room when they are ready. Come back to the Move step.",
  2: "Next: harvest when the flower days are up.",
  3: "Next: let it dry, then enter the dry weight.",
  4: "Next: package it. Packages and labels are drafted for you.",
  5: "All done. Lab results come next, on each package.",
};

function RoomSelect({ data, name, label, defaultValue, required = true, onChange }: { data: GrowData; name: string; label: string; defaultValue?: string; required?: boolean; onChange?: (id: string) => void }) {
  return (
    <CreatableSelect
      name={name}
      label={label}
      required={required}
      placeholder="Choose a room"
      defaultValue={defaultValue}
      onChange={onChange}
      options={data.rooms.map((r) => ({ id: r.id, label: r.name }))}
      create={data.canAddRoom ? { buttonLabel: "Add room", title: "Add a room", intro: "It's added to this facility's rooms and picked here.", submitLabel: "Save room", action: quickRoomAction, fields: <RoomFields /> } : undefined}
      deniedHint="Room missing? Ask a manager to add it in Settings → Facilities."
    />
  );
}

/** Groups of plants to tick (a batch in one room at one stage), so a whole room is one tap. */
function PlantGroups({ groups, empty }: { groups: GrowData["plantGroups"]; empty: string }) {
  const [on, setOn] = useState<Set<string>>(new Set());
  if (!groups.length) return <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{empty}</p>;
  const toggle = (key: string) => setOn((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const chosen = groups.filter((g) => on.has(g.key));
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 flex w-full items-center justify-between text-sm font-semibold text-slate-800">
        Which plants
        <button type="button" className="text-xs font-bold text-brand-700 hover:underline" onClick={() => setOn(on.size === groups.length ? new Set() : new Set(groups.map((g) => g.key)))}>
          {on.size === groups.length ? "Clear" : "Tick all"}
        </button>
      </legend>
      {groups.map((g) => (
        <label key={g.key} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${on.has(g.key) ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <input type="checkbox" checked={on.has(g.key)} onChange={() => toggle(g.key)} className="h-5 w-5 accent-brand-700" />
          <span className="min-w-0 flex-1 text-sm font-semibold">{g.label}</span>
          <span className="text-sm text-slate-600">{g.ids.length} plant{g.ids.length === 1 ? "" : "s"}</span>
        </label>
      ))}
      {chosen.flatMap((g) => g.ids).map((id) => <input key={id} type="hidden" name="plantId" value={id} />)}
    </fieldset>
  );
}

function TagFields({ data }: { data: GrowData }) {
  const [batchId, setBatchId] = useState(data.untaggedBatches[0]?.id ?? "");
  const batch = data.untaggedBatches.find((b) => b.id === batchId);
  if (!data.untaggedBatches.length) return <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Every plant is tagged. Start a batch first if you have new clones or seeds.</p>;
  return (
    <>
      <Field label="Batch">
        <select name="batchId" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputClass} required>
          {data.untaggedBatches.map((b) => (
            <option key={b.id} value={b.id}>{b.name} · {b.strain} · {b.untagged} untagged</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How many to tag" hint="The batch's untagged count is filled in. Tag fewer if you are doing some now.">
          <input key={batchId} name="count" inputMode="numeric" required defaultValue={batch?.untagged} className={inputClass} />
        </Field>
        <Field label="First tag (optional)" hint="Blank = new tags in order. Or type the first tag of a roll and the rest follow.">
          <input name="firstTag" className={inputClass} placeholder="Blank = automatic" />
        </Field>
      </div>
      <RoomSelect key={batchId} data={data} name="locationId" label="Room" defaultValue={batch?.roomId} />
    </>
  );
}

export function GrowGuide({ data }: { data: GrowData }) {
  const [step, setStep] = useState(data.suggested);
  const [saved, setSaved] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const flowering = useMemo(() => data.plantGroups.filter((g) => g.phase === "FLOWERING"), [data.plantGroups]);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const form = (e as CustomEvent<HTMLElement | null>).detail;
      if (form && panel.current?.contains(form)) setSaved(step);
    };
    window.addEventListener("ct:form-saved", onSaved);
    return () => window.removeEventListener("ct:form-saved", onSaved);
  }, [step]);

  const go = (i: number) => {
    setStep(i);
    setSaved(null);
  };
  const s = STEPS[step];

  return (
    <div className="space-y-4" data-testid="grow-guide">
      <nav aria-label="Grow steps" className="flex flex-wrap gap-2">
        {STEPS.map((x, i) => (
          <button
            key={x.short}
            type="button"
            onClick={() => go(i)}
            aria-current={i === step ? "step" : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${i === step ? "border-brand-800 bg-brand-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-brand-50"}`}
          >
            {i + 1}. {x.short}
          </button>
        ))}
      </nav>

      <div ref={panel} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-bold" data-testid="grow-title">{s.title}</h2>
          <span className="text-sm text-slate-500">Step {step + 1} of {STEPS.length}</span>
        </div>
        <p className="mb-4 mt-1 text-sm text-slate-600">{s.info}</p>

        {step === 0 ? (
          <ActionForm key="s0" action={growBatchAction} submitLabel="Start batch">
            <CreatableSelect
              name="strainId"
              label="Strain"
              required
              placeholder="Choose a strain"
              options={data.strains.map((x) => ({ id: x.id, label: x.name }))}
              create={{ buttonLabel: "Add strain", title: "Add a strain", intro: "It's saved to your strains and picked here.", submitLabel: "Save strain", action: quickStrainAction, fields: <StrainFields /> }}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Started from">
                <select name="source" defaultValue="CLONE" className={inputClass}>
                  <option value="CLONE">Clones</option>
                  <option value="SEED">Seeds</option>
                </select>
              </Field>
              <Field label="How many">
                <input name="count" inputMode="numeric" required className={inputClass} />
              </Field>
            </div>
            <RoomSelect data={data} name="locationId" label="Room" />
            <Field label="Batch name (optional)" hint="Blank = the strain and today's date.">
              <input name="name" className={inputClass} placeholder="Blank = automatic" />
            </Field>
          </ActionForm>
        ) : null}

        {step === 1 ? (
          <ActionForm key="s1" action={tagPlantsAction} submitLabel="Tag plants">
            <TagFields data={data} />
          </ActionForm>
        ) : null}

        {step === 2 ? (
          <ActionForm key="s2" action={growMoveAction} submitLabel="Save">
            <PlantGroups groups={data.plantGroups} empty="No tagged plants yet. Tag a batch first." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New stage">
                <select name="stage" defaultValue="" className={inputClass}>
                  <option value="">No change</option>
                  <option value="FLOWERING">Flowering</option>
                  <option value="VEGETATIVE">Vegetative</option>
                </select>
              </Field>
              <RoomSelect data={data} name="locationId" label="Move to room" required={false} />
            </div>
          </ActionForm>
        ) : null}

        {step === 3 ? (
          <ActionForm key="s3" action={growHarvestAction} submitLabel="Record harvest">
            <PlantGroups groups={flowering} empty="No flowering plants yet. Move plants to flowering first." />
            <Field label="Wet weight">
              <WeightInput name="wetWeight" unitName="wetUnit" required remember="wet" />
            </Field>
            <RoomSelect data={data} name="dryLocationId" label="Dry in room" />
            <Field label="Harvest name (optional)" hint="Blank = Harvest and today's date.">
              <input name="harvestName" className={inputClass} placeholder="Blank = automatic" />
            </Field>
          </ActionForm>
        ) : null}

        {step === 4 ? (
          data.dryingHarvests.length ? (
            <div className="space-y-6">
              <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-800" data-testid="drying-status">
                {data.dryingHarvests.some((h) => h.ready)
                  ? "Some harvests have dried long enough to weigh. Pick one below."
                  : "Everything is still drying, so there is nothing to do here yet. Come back in a few days. You can start or tag other batches in the meantime."}
                <ul className="mt-1 list-disc pl-5">
                  {data.dryingHarvests.map((h) => (
                    <li key={h.id}>{h.label.split(" · drying")[0]}: day {h.day}{h.ready ? ", ready to weigh" : ", still drying"}</li>
                  ))}
                </ul>
              </div>
              <ActionForm key="s4" action={dryWeightAction} submitLabel="Save dry weight">
                <Field label="Harvest">
                  <select name="harvestId" required className={inputClass}>
                    {data.dryingHarvests.map((h) => (
                      <option key={h.id} value={h.id}>{h.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Dry weight">
                  <WeightInput name="weight" unitName="unit" required remember="dry" />
                </Field>
              </ActionForm>
              <details className="rounded-xl border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-800">Log waste from this harvest (stems, trim)</summary>
                <div className="mt-3">
                  <ActionForm key="s4w" action={wasteAction} submitLabel="Log waste" quiet>
                    <Field label="Harvest">
                      <select name="harvestId" required className={inputClass}>
                        {data.dryingHarvests.map((h) => (
                          <option key={h.id} value={h.id}>{h.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Weight">
                      <WeightInput name="weight" unitName="unit" required remember="waste" />
                    </Field>
                    <Field label="Reason" hint="A reason is needed for any waste record.">
                      <input name="reason" required className={inputClass} placeholder="Stems and trim" />
                    </Field>
                  </ActionForm>
                </div>
              </details>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">No harvests are waiting for a dry weight. Record a harvest first.</p>
          )
        ) : null}

        {step === 5 ? (
          data.packableHarvests.length ? (
            <div className="space-y-6">
              <ActionForm key="s5" action={packageHarvestAction} submitLabel="Create packages">
                <Field label="Harvest">
                  <select name="harvestId" required className={inputClass}>
                    {data.packableHarvests.map((h) => (
                      <option key={h.id} value={h.id}>{h.label} · {h.left} left</option>
                    ))}
                  </select>
                </Field>
                <Field label="Item">
                  <select name="itemId" required className={inputClass} defaultValue="">
                    <option value="" disabled>Choose an item</option>
                    {data.items.map((i) => (
                      <option key={i.id} value={i.id}>{i.label}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Weight of each package" hint="In the item's unit.">
                    <input name="quantity" inputMode="decimal" required className={inputClass} />
                  </Field>
                  <Field label="How many packages">
                    <input name="count" inputMode="numeric" defaultValue="1" className={inputClass} />
                  </Field>
                </div>
                <RoomSelect data={data} name="locationId" label="Put away to" />
                <Field label="Tags (optional)" hint="Blank = new package IDs. Or one tag per package.">
                  <input name="tag" className={inputClass} placeholder="Blank = automatic" />
                </Field>
              </ActionForm>
              {data.finishable.length ? (
                <ActionForm key="s5f" action={finishHarvestAction} submitLabel="Finish harvest" quiet>
                  <Field label="Done packaging? Close the harvest" hint="Only once everything is packaged or logged as waste.">
                    <select name="harvestId" required className={inputClass}>
                      {data.finishable.map((h) => (
                        <option key={h.id} value={h.id}>{h.label}</option>
                      ))}
                    </select>
                  </Field>
                </ActionForm>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Nothing is ready to package. Enter a dry weight first.</p>
          )
        ) : null}
      </div>

      {saved === step ? (
        <div role="status" className="rounded-2xl border border-brand-200 bg-brand-50 p-4" data-testid="grow-next">
          <p className="font-bold text-brand-900">{NEXT[step]}</p>
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => go(step + 1)} className="mt-3 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800" data-testid="grow-continue">
              Continue to {STEPS[step + 1].short.toLowerCase()}
            </button>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
