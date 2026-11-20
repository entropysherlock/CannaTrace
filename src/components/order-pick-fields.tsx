"use client";

import { useState } from "react";
import { PackageChoice, type PackageOption } from "./package-choice";
import { Field, inputClass } from "./ui";

type Line = { id: string; itemId: string; label: string };

/** Which line, then which package of that item, picked from a list. No scanner or tag needed. */
export function OrderPickFields({ lines, packages, firstId }: { lines: Line[]; packages: (PackageOption & { itemId: string })[]; firstId: string }) {
  const [lineId, setLineId] = useState(firstId);
  const itemId = lines.find((l) => l.id === lineId)?.itemId;
  return (
    <>
      <Field label="For line">
        <select name="lineId" required value={lineId} onChange={(e) => setLineId(e.target.value)} className={inputClass}>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Package" hint="The active packages of this item. Pick one, or type or scan a tag.">
        <PackageChoice key={lineId} name="tag" options={packages.filter((p) => p.itemId === itemId)} empty="There is no active stock of this item here. Receive some first, or type a tag." />
      </Field>
    </>
  );
}
