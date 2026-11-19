import Link from "next/link";
import { strainTypeEnum } from "@/db/schema";
import { Field, inputClass } from "./ui";
import { WeightUnitSelect } from "./weight-unit-select";

const TABS = [
  { href: "/cultivation", label: "Overview" },
  { href: "/cultivation/plants", label: "Plants" },
  { href: "/cultivation/harvests", label: "Harvests" },
  { href: "/cultivation/strains", label: "Strains" },
];

export function CultivationTabs({ current }: { current: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-brand-100 bg-white p-1.5 shadow-sm [scrollbar-width:none]">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-lg px-4 text-sm font-bold transition-colors ${
            tab.href === current ? "bg-brand-600 text-white shadow-sm" : "text-brand-800 hover:bg-brand-50"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** A weight box with a unit picker beside it. */
/** A weight box with a unit picker that remembers the last unit used for `remember` (dry weight, waste, ...). */
export function WeightInput({ name, unitName, required, remember, defaultUnit }: { name: string; unitName: string; required?: boolean; remember: string; defaultUnit?: string }) {
  return (
    <span className="flex gap-2">
      <input name={name} inputMode="decimal" required={required} className={inputClass} />
      <WeightUnitSelect name={unitName} remember={remember} defaultUnit={defaultUnit} />
    </span>
  );
}

export function grams(value: string | null): string {
  if (value === null) return "not recorded";
  const n = Number(value);
  return n >= 1000 ? `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} kg` : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} g`;
}

export function daysSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

/** A strain's fields. Used by the Strains tab and by "Add strain" inside Start a batch, so both ask the same things. */
export function StrainFields() {
  return (
    <>
      <Field label="Name">
        <input name="name" required maxLength={80} className={inputClass} />
      </Field>
      <Field label="Type">
        <select name="type" required defaultValue="HYBRID" className={inputClass}>
          {strainTypeEnum.enumValues.map((type) => (
            <option key={type} value={type}>
              {type === "CBD" ? "CBD" : type.charAt(0) + type.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Flowering days (optional)">
        <input name="floweringDays" inputMode="numeric" className={inputClass} />
      </Field>
    </>
  );
}
