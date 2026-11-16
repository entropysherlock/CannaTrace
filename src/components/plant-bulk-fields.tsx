"use client";

import { useState } from "react";
import { Field, inputBase, inputClass } from "./ui";

type Option = { id: string; name: string };

/** Picks what to do with the ticked plants and shows only the boxes that action needs. */
export function PlantBulkFields({ locations }: { locations: Option[] }) {
  const [action, setAction] = useState("");
  const weightUnits = (
    <>
      <option value="G">g</option>
      <option value="KG">kg</option>
      <option value="LB">lb</option>
      <option value="OZ">oz</option>
    </>
  );
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-slate-900">With the ticked plants</p>
        <button
          type="button"
          className="text-sm font-semibold text-emerald-700 hover:underline"
          onClick={(event) => {
            const boxes = event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="plantId"]') ?? [];
            const allTicked = Array.from(boxes).every((box) => box.checked);
            boxes.forEach((box) => (box.checked = !allTicked));
          }}
        >
          Tick or untick all
        </button>
      </div>
      <select name="bulkAction" required value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" className={inputClass}>
        <option value="" disabled>
          Choose what to do
        </option>
        <option value="FLOWERING">Switch to flowering</option>
        <option value="VEGETATIVE">Switch back to vegetative</option>
        <option value="MOVE">Move to another room</option>
        <option value="HARVEST">Harvest</option>
        <option value="DESTROY">Destroy</option>
      </select>

      {action === "MOVE" ? (
        <Field label="Move to">
          <select name="locationId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose a room
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {action === "HARVEST" ? (
        <>
          <Field label="Harvest name" hint="For example the strain initials and today's date. It becomes the lot number on every package made from this harvest.">
            <input name="harvestName" required className={inputClass} />
          </Field>
          <Field label="Total wet weight of the ticked plants">
            <span className="flex gap-2">
              <input name="wetWeight" inputMode="decimal" required className={inputClass} />
              <select name="wetUnit" defaultValue="KG" aria-label="Weight unit" className={`${inputBase} w-24 shrink-0`}>
                {weightUnits}
              </select>
            </span>
          </Field>
          <Field label="Drying room">
            <select name="dryLocationId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Choose a room
              </option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      {action === "DESTROY" ? (
        <>
          <Field label="Reason" hint="Required. Shown in the audit trail. This cannot be undone.">
            <input name="reason" required className={inputClass} />
          </Field>
          <Field label="Waste weight (optional)">
            <span className="flex gap-2">
              <input name="waste" inputMode="decimal" className={inputClass} />
              <select name="wasteUnit" defaultValue="G" aria-label="Weight unit" className={`${inputBase} w-24 shrink-0`}>
                {weightUnits}
              </select>
            </span>
          </Field>
        </>
      ) : null}
    </div>
  );
}
