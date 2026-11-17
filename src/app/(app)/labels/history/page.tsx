import Link from "next/link";
import { JobActions } from "@/components/labels/job-actions";
import { Card, PageHeader } from "@/components/ui";
import { listJobs } from "@/lib/labels/service";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";

export const instant = false;

const BADGE: Record<string, string> = {
  QUEUED: "bg-slate-200 text-slate-800",
  RENDERED: "bg-sky-600 text-white",
  PRINTED: "bg-brand-600 text-white",
  FAILED: "bg-red-600 text-white",
  CANCELLED: "bg-slate-400 text-white",
};
const LABEL: Record<string, string> = { QUEUED: "queued", RENDERED: "pdf opened", PRINTED: "printed", FAILED: "failed", CANCELLED: "cancelled" };

export default async function LabelHistoryPage() {
  const session = await requirePagePermission("labels.print");
  const jobs = await listJobs(session, 200);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Label history"
        subtitle="Every print and reprint, with the exact template version used, who started it, and what happened. Printing never changes inventory."
        action={can(session, "audit.view") ? <Link href="/audit" className="text-sm font-semibold text-brand-700 underline">Full audit trail</Link> : null}
      />
      <Card>
        {jobs.length === 0 ? (
          <p className="text-sm text-slate-600">No labels printed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="label-history">
              <thead>
                <tr>
                  <th className="text-left">When</th>
                  <th className="text-left">Template</th>
                  <th className="text-right">Labels</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">By</th>
                  <th className="text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(({ job, template }) => (
                  <tr key={job.id}>
                    <td className="whitespace-nowrap">{job.createdAt.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "short", timeStyle: "short" })}</td>
                    <td>
                      {template} <span className="text-xs text-slate-500">v{job.templateVersion}</span>
                      {job.reprintOf ? <span className="ml-1 text-xs font-semibold text-brand-700">reprint</span> : null}
                      {job.error ? <p className="max-w-md text-xs text-red-700">{job.error}</p> : null}
                    </td>
                    <td className="text-right tabular-nums">
                      {job.labelCount}
                      {job.copies > 1 ? <span className="text-xs text-slate-500"> ({job.copies}×)</span> : null}
                    </td>
                    <td>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${BADGE[job.status]}`}>{LABEL[job.status]}</span>
                      {job.attempts > 1 ? <span className="ml-1 text-xs text-slate-500">{job.attempts} tries</span> : null}
                    </td>
                    <td>{job.userName}</td>
                    <td>
                      <JobActions id={job.id} status={job.status} blocked={job.attempts === 0 && !!job.error?.startsWith("Blocked")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
