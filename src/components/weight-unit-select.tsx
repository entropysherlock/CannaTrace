"use client";

import { useEffect, useRef } from "react";
import { inputBase } from "./ui";

const UNITS = [
  ["G", "g"],
  ["KG", "kg"],
  ["LB", "lb"],
  ["OZ", "oz"],
] as const;
const VALID = new Set<string>(UNITS.map(([v]) => v));

function stored(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    return v && VALID.has(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The g / kg / lb / oz picker next to a weight box. It remembers the last unit picked for this
 * kind of weight (on this browser) and keeps it after the form saves, instead of jumping back
 * to its starting unit.
 */
export function WeightUnitSelect({ name, remember, defaultUnit = "G" }: { name: string; remember: string; defaultUnit?: string }) {
  const ref = useRef<HTMLSelectElement>(null);
  const key = `cannatrace.weightUnit.${remember}`;

  useEffect(() => {
    const select = ref.current;
    if (!select) return;
    const saved = stored(key);
    if (saved) select.value = saved;
    // A successful save resets the form, which would put the picker back on its starting unit.
    // Put the remembered unit back right after the reset.
    const form = select.form;
    const restore = () =>
      setTimeout(() => {
        const unit = stored(key);
        if (unit && ref.current) ref.current.value = unit;
      }, 0);
    form?.addEventListener("reset", restore);
    return () => form?.removeEventListener("reset", restore);
  }, [key]);

  return (
    <select
      ref={ref}
      name={name}
      defaultValue={defaultUnit}
      aria-label="Weight unit"
      onChange={(e) => {
        try {
          window.localStorage.setItem(key, e.target.value);
        } catch {
          // Private browsing can refuse storage; the picker still works, it just won't remember.
        }
      }}
      className={`${inputBase} w-24 shrink-0`}
    >
      {UNITS.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
