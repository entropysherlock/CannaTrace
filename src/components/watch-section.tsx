import { Eye } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { WatchList, type WatchItem } from "@/components/watch-list";
import { dismissAction, sweepNowAction, uploadStateReportAction } from "@/app/(app)/dashboard/watch-actions";
import type { WatchFinding } from "@/db/schema";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { lastSweep, latestStateReport } from "@/lib/watch";
import { facilityZone } from "@/lib/time";

const when = (d: Date, zone: string) => d.toLocaleString("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" });

/** Tally Watch on the Dashboard: what needs attention, each with its fix ready to approve. */
export async function WatchSection({ session, findings }: { session: Session; findings: WatchFinding[] }) {
  const zone = await facilityZone(session.facilityId);
  const [sweep, report] = await Promise.all([lastSweep(session), latestStateReport(session)]);
  const items: WatchItem[] = findings.map((f) => ({
    id: f.id,
    severity: f.severity as WatchItem["severity"],
    title: f.title,
    detail: f.detail,
    href: f.href,
    fixLabel: f.fix?.label ?? null,
    ask: f.ask,
    since: when(f.firstSeenAt, zone),
  }));
  const urgent = items.filter((i) => i.severity === "critical").length;

  return (
    <section id="tally-watch" className="mb-6 scroll-mt-20" aria-labelledby="tally-watch-heading" data-watch-section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="tally-watch-heading" className="text-lg font-bold text-brand-950">
            Tally Watch{items.length ? ` · ${items.length} to look at${urgent ? `, ${urgent} urgent` : ""}` : ""}
          </h2>
          <p className="text-xs text-slate-500">
            Tally checks the business on its own{sweep ? `; last checked ${when(sweep.createdAt, zone)}` : ""}. You approve every fix, and every fix can be undone.
          </p>
        </div>
        <form action={sweepNowAction}>
          <button type="submit" className="inline-flex min-h-9 items-center gap-2 rounded-lg border-2 border-brand-200 bg-white px-3 text-sm font-bold text-brand-800 hover:border-brand-500">
            <Eye className="h-4 w-4" aria-hidden="true" /> Check now
          </button>
        </form>
      </div>
      <WatchList items={items} dismiss={dismissAction} sweep={sweepNowAction} />
      {can(session, "compliance.view") ? (
        <details className="mt-3 rounded-2xl border border-brand-100 bg-white px-5 py-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-brand-800">
            Match against the state system{report ? ` · last report ${when(report.createdAt, zone)}, ${report.count.toLocaleString("en-US")} packages` : ""}
          </summary>
          <p className="mt-2 text-sm text-slate-600">
            Export your Packages list from the state system (for example Metrc → Packages → Active → Export as CSV) and upload it here. Tally Watch flags every package
            that&apos;s missing on either side or has a different quantity. A live connection replaces this once CannaTrace is an approved integrator.
          </p>
          <ActionForm action={uploadStateReportAction} submitLabel="Upload and compare" className="mt-3 space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              State package report (CSV)
              <input type="file" name="file" accept=".csv,text/csv" required className="mt-1 block w-full text-sm" />
            </label>
          </ActionForm>
        </details>
      ) : null}
    </section>
  );
}
