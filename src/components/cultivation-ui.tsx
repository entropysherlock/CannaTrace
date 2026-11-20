import Link from "next/link";
import { strainTypeEnum } from "@/db/schema";
import { Field, inputClass } from "./ui";
import { WeightUnitSelect } from "./weight-unit-select";

const TABS = [
  { href: "/cultivation/overview", label: "Overview" },
  { href: "/cultivation", label: "Grow guide" },
  { href: "/cultivation/plants", label: "Plants" },
  { href: "/cultivation/harvests", label: "Harvests" },
  { href: "/cultivation/strains", label: "Strains" },
];

export function CultivationTabs({ current }: { current: string }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1 rounded-xl border border-brand-100 bg-white p-1.5 shadow-sm">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`inline-flex min-h-10 items-center rounded-lg px-3 sm:px-4 text-sm font-bold transition-colors ${
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

/**
 * Where a harvest stands: its weights, and how much of the dry weight is packaged, logged as waste, or still
 * to account for, with the next step. A harvest can only be finished once nothing is left.
 */
export function HarvestSummary(props: {
  wet: string;
  dry: string | null;
  moisture: string | null;
  packaged: string;
  waste: string;
  onHand: string;
  finishedOn: string | null;
}) {
  const dry = props.dry === null ? null : Number(props.dry);
  const packaged = Number(props.packaged);
  const waste = Number(props.waste);
  const left = Math.max(0, Number(props.onHand));
  const pct = (n: number) => (dry ? `${Math.min(100, (n / dry) * 100)}%` : "0%");
  const next = props.finishedOn
    ? `Finished on ${props.finishedOn}.`
    : dry === null
      ? "Next: weigh it once it's dry and record the dry weight."
      : left > 0
        ? `Next: package or log as waste the ${grams(String(left))} left, then finish the harvest.`
        : "Everything is accounted for. Finish the harvest.";
  const tile = (label: string, value: string, sub?: string, strong = false) => (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${strong ? "border-brand-200 bg-brand-50" : "border-brand-100 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-extrabold tracking-tight ${strong ? "text-2xl text-brand-950" : "text-xl text-slate-900"}`}>{value}</p>
      {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
  return (
    <div className="mb-5 space-y-3" data-testid="harvest-summary">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tile("Wet weight", grams(props.wet))}
        {tile("Dry weight", grams(props.dry), props.moisture ? `${grams(props.moisture)} moisture loss` : undefined)}
        {tile("Packaged", grams(props.packaged))}
        {tile("Waste", grams(props.waste))}
        {props.finishedOn ? tile("Status", "Finished", undefined, true) : tile("Left to account for", dry === null ? "—" : grams(String(left)), undefined, true)}
      </div>
      <div className="rounded-xl border border-brand-100 bg-white px-4 py-3 shadow-sm">
        {dry ? (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Of the dry weight: ${grams(props.packaged)} packaged, ${grams(props.waste)} waste, ${grams(String(left))} left`}>
              <span className="h-full bg-brand-600" style={{ width: pct(packaged) }} />
              <span className="h-full bg-slate-400" style={{ width: pct(waste) }} />
              <span className="h-full bg-amber-400" style={{ width: pct(left) }} />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden="true" />Packaged</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />Waste</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />Left</span>
            </p>
          </>
        ) : null}
        <p className={`text-sm font-medium text-slate-800 ${dry ? "mt-2" : ""}`}>{next}</p>
      </div>
    </div>
  );
}
