import { and, eq } from "drizzle-orm";
import { AskAboutButton } from "@/components/assistant-panel";
import { JobActions } from "@/components/labels/job-actions";
import { PrintStation } from "@/components/labels/print-station";
import { Card, PageHeader } from "@/components/ui";
import { plants } from "@/db/schema";
import { db } from "@/lib/db";
import { labelCandidates } from "@/lib/labels/data";
import { listJobs, listPrinters, listTemplates } from "@/lib/labels/service";
import { LABEL_KINDS, type LabelKind } from "@/lib/labels/types";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { prepareLabels, sizeLabel } from "./shared";

export const instant = false;

const STATUS: Record<string, string> = {
  QUEUED: "Waiting to open",
  RENDERED: "PDF opened, not confirmed",
  PRINTED: "Printed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ kind?: string; ids?: string; batch?: string }> }) {
  const session = await requirePagePermission("labels.print");
  await prepareLabels(session);
  const sp = await searchParams;
  const kind: LabelKind = LABEL_KINDS.some((k) => k.kind === sp.kind) ? (sp.kind as LabelKind) : "PACKAGE";
  let ids = (sp.ids ?? "").split(",").filter(Boolean).slice(0, 1000);
  if (kind === "PLANT" && sp.batch && ids.length === 0) {
    // "Print plant tags" from a batch: preselect that batch's live plants at this facility.
    const rows = await db
      .select({ id: plants.id })
      .from(plants)
      .where(and(eq(plants.orgId, session.orgId), eq(plants.facilityId, session.facilityId), eq(plants.batchId, sp.batch), eq(plants.status, "ACTIVE")))
      .limit(1000);
    ids = rows.map((r) => r.id);
  }
  const [templates, printers, candidates, jobs] = await Promise.all([listTemplates(session), listPrinters(session), labelCandidates(session), listJobs(session, 40)]);
  const open = jobs.filter((j) => j.job.status === "QUEUED" || j.job.status === "RENDERED" || j.job.status === "FAILED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="SmartLabel AI"
        subtitle="Labels fill in from your saved records, get checked for missing data, barcode problems, and verified state label rules, then print as an exact-size PDF."
        action={<AskAboutButton label="Ask Cousin Towel" prompt="Find labels that would be missing required information right now, and tell me how to fix them." />}
      />
      <PrintStation
        templates={templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, isDefault: t.isDefault, jurisdiction: t.jurisdiction, size: sizeLabel(t.design.widthMm, t.design.heightMm) }))}
        printers={printers.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
        candidates={candidates}
        initialKind={kind}
        initialIds={ids}
        canManage={can(session, "labels.manage")}
      />
      <Card title={`Print queue (${open.length})`}>
        {open.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing waiting. Jobs you start show here until someone confirms they printed.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="label-queue">
            {open.map(({ job, template }) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {template} · {job.labelCount} label{job.labelCount === 1 ? "" : "s"}
                    {job.reprintOf ? <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-800">Reprint</span> : null}
                  </p>
                  <p className="text-xs text-slate-600">
                    {STATUS[job.status]} · {job.userName} · {job.createdAt.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" })}
                    {job.attempts ? ` · ${job.attempts} attempt${job.attempts === 1 ? "" : "s"}` : ""}
                  </p>
                  {job.error ? <p className="text-xs font-medium text-red-700">{job.error}</p> : null}
                </div>
                <JobActions id={job.id} status={job.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
