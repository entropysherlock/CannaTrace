"use client";

import { useState } from "react";
import { CreatableSelect, type CreateConfig } from "./contextual-create";
import { Field, inputClass } from "./ui";
import { WeightUnitSelect } from "./weight-unit-select";

type Option = { id: string; name: string };

/** Picks what to do with the checked plants and shows only the boxes that action needs. */
export function PlantBulkFields({
  locations,
  addMoveRoom,
  addDryRoom,
}: {
  locations: Option[];
  /** Set when this person may add rooms; the room is added without leaving the plant list. */
  addMoveRoom?: CreateConfig;
  addDryRoom?: CreateConfig;
}) {
  const options = locations.map((l) => ({ id: l.id, label: l.name }));
  const deniedHint = "Room missing? Ask a manager to add it in Settings → Facilities.";
  const [action, setAction] = useState("");
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-slate-900">With the checked plants</p>
        <button
          type="button"
          className="text-sm font-semibold text-brand-700 hover:underline"
          onClick={(event) => {
            const boxes = event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="plantId"]') ?? [];
            const allTicked = Array.from(boxes).every((box) => box.checked);
            boxes.forEach((box) => (box.checked = !allTicked));
          }}
        >
          Check or uncheck all
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

      {action === "FLOWERING" || action === "VEGETATIVE" ? (
        <CreatableSelect name="locationId" label="New room (optional)" placeholder="Stay in the same room" options={options} create={addMoveRoom} deniedHint={deniedHint} />
      ) : null}

      {action === "MOVE" ? (
        <CreatableSelect name="locationId" label="Move to" required placeholder="Choose a room" options={options} create={addMoveRoom} deniedHint={deniedHint} />
      ) : null}

      {action === "HARVEST" ? (
        <>
          <Field label="Harvest name" hint="For example the strain initials and today's date. It becomes the lot number on every package made from this harvest.">
            <input name="harvestName" required className={inputClass} />
          </Field>
          <Field label="Total wet weight of the checked plants">
            <span className="flex gap-2">
              <input name="wetWeight" inputMode="decimal" required className={inputClass} />
              <WeightUnitSelect name="wetUnit" remember="wet" defaultUnit="KG" />
            </span>
          </Field>
          <CreatableSelect name="dryLocationId" label="Drying room" required placeholder="Choose a room" options={options} create={addDryRoom} deniedHint={deniedHint} />
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
              <WeightUnitSelect name="wasteUnit" remember="waste" />
            </span>
          </Field>
        </>
      ) : null}
    </div>
  );
}
