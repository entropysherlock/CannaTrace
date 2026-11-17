import { Eye } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/ui";
import { WatchList, type WatchItem } from "@/components/watch-list";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { lastSweep, latestStateReport, openFindings, sweepIfStale } from "@/lib/watch";
import { dismissAction, sweepNowAction, uploadStateReportAction } from "./actions";

const TZ = "America/Denver";
const when = (d: Date) => d.toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });

export default async function WatchPage() {
  const session = await requireSession();
  await sweepIfStale(session);
  const [findings, sweep, report] = await Promise.all([openFindings(session), lastSweep(session), latestStateReport(session)]);
  const items: WatchItem[] = findings.map((f) => ({
    id: f.id,
    severity: f.severity as WatchItem["severity"],
    title: f.title,
    detail: f.detail,
    href: f.href,
    fixLabel: f.fix?.label ?? null,
    ask: f.ask,
    since: when(f.firstSeenAt),
  }));
  const counts = { critical: items.filter((i) => i.severity === "critical").length, warning: items.filter((i) => i.severity === "warning").length };

  return (
    <>
      <PageHeader
        title="Tally Watch"
        subtitle="Tally checks the business on its own and brings you each problem with the fix ready. You approve every fix, and every fix can be undone."
        action={
          <form action={sweepNowAction}>
            <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-brand-200 bg-white px-4 text-sm font-bold text-brand-800 hover:border-brand-500">
              <Eye className="h-4 w-4" aria-hidden="true" /> Check now
            </button>
          </form>
        }
      />
      <p className="mb-4 text-sm text-slate-600" role="status">
        {items.length ? `${counts.critical} urgent, ${counts.warning} soon, ${items.length - counts.critical - counts.warning} FYI.` : ""}{" "}
        {sweep ? `Last checked ${when(sweep.createdAt)}. Checks run every morning and whenever this page is opened.` : ""}
      </p>
      <WatchList items={items} dismiss={dismissAction} sweep={sweepNowAction} />

      {can(session, "compliance.view") ? (
        <section className="mt-8 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm" aria-labelledby="state-match">
          <h2 id="state-match" className="text-lg font-bold text-brand-950">
            Match against the state system
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Export your Packages list from the state system (for example Metrc → Packages → Active → Export as CSV) and upload it here. Tally Watch flags every package
            that&apos;s missing on either side or has a different quantity. A live connection replaces this once CannaTrace is an approved integrator.
          </p>
          {report ? (
            <p className="mt-2 text-sm font-medium text-slate-700">
              Last report: {report.fileName}, {report.count.toLocaleString("en-US")} packages, uploaded by {report.uploadedByName} {when(report.createdAt)}.
            </p>
          ) : null}
          <ActionForm action={uploadStateReportAction} submitLabel="Upload and compare" className="mt-3 space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              State package report (CSV)
              <input type="file" name="file" accept=".csv,text/csv" required className="mt-1 block w-full text-sm" />
            </label>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
