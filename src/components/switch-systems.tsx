import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";

/** Where a business coming from another system starts. The importer itself lives on Reports → Import and export. */
export const SWITCH_HREF = "/data#switch-from-dutchie";

/** On an empty facility's dashboard: the first step for a store moving over from Dutchie. */
export function SwitchBanner() {
  return (
    <section
      data-testid="switch-banner"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 sm:px-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ArrowRightLeft className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-bold text-brand-950">Coming from Dutchie? Bring your inventory with you.</p>
          <p className="text-sm text-brand-900">Upload your Dutchie inventory report and your products, rooms, and packages load in one step. You see everything before it&apos;s saved.</p>
        </div>
      </div>
      <Link href={SWITCH_HREF} className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">
        Bring my data from Dutchie
      </Link>
    </section>
  );
}
