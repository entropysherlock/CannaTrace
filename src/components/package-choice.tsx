"use client";

import { useState } from "react";
import { ScanInput } from "./scan-input";
import { inputClass } from "./ui";

export type PackageOption = { tag: string; label: string };

/**
 * Pick a package from the ones that fit, so nobody needs a scanner or has to know a tag.
 * "Type or scan a tag instead" is still there for a package that isn't in the list.
 */
export function PackageChoice({ name, options, onPick, empty = "No packages are available for this." }: { name: string; options: PackageOption[]; onPick?: (tag: string) => void; empty?: string }) {
  const [typing, setTyping] = useState(false);
  const [filter, setFilter] = useState("");
  const shown = filter.trim() ? options.filter((o) => o.label.toLowerCase().includes(filter.trim().toLowerCase())) : options;
  if (typing || !options.length)
    return (
      <div>
        <ScanInput name={name} required />
        {options.length ? (
          <button type="button" onClick={() => setTyping(false)} className="mt-1 text-sm font-semibold text-brand-700 hover:underline">
            Choose from the list instead
          </button>
        ) : (
          <p className="mt-1 text-sm text-slate-600">{empty}</p>
        )}
      </div>
    );
  return (
    <div className="space-y-2">
      {options.length > 8 ? <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by tag, item or lot" className={inputClass} aria-label="Search packages" /> : null}
      <select name={name} required defaultValue="" onChange={(e) => onPick?.(e.target.value)} className={`${inputClass} font-mono`} aria-label="Package">
        <option value="" disabled>
          Choose a package
        </option>
        {shown.map((o) => (
          <option key={o.tag} value={o.tag}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setTyping(true)} className="text-sm font-semibold text-brand-700 hover:underline">
        Type or scan a tag instead
      </button>
    </div>
  );
}
