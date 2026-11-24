import { AlertOctagon, CheckCircle2, Printer } from "lucide-react";
import Link from "next/link";
import { TemplateActions } from "@/components/labels/template-actions";
import { Card, PageHeader, buttonLinkClass } from "@/components/ui";
import { sampleValues } from "@/lib/labels/fields";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { listTemplates } from "@/lib/labels/service";
import { LABEL_KINDS } from "@/lib/labels/types";
import { checkDesign, checkJurisdiction } from "@/lib/labels/validate";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { prepareLabels, sizeLabel } from "../shared";

export const instant = false;

export default async function TemplatesPage() {
  const session = await requirePagePermission("labels.print");
  await prepareLabels(session);
  const manage = can(session, "labels.manage");
  const templates = await listTemplates(session, { includeArchived: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Label templates"
        subtitle="Layouts for each kind of label. Every save keeps the old version, so any printed label can be traced to the exact design used."
        action={manage ? <Link href="/labels/templates/new" className={buttonLinkClass}>New template</Link> : null}
      />
      {LABEL_KINDS.map((k) => {
        const list = templates.filter((t) => t.kind === k.kind);
        return (
          <Card key={k.kind} title={k.label}>
            {list.length === 0 ? (
              <p className="text-sm text-slate-600">No {k.label.toLowerCase()} templates yet.</p>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {list.map((t) => {
                  const issues = [...checkDesign(t.design, t.kind), ...checkJurisdiction(t.design, t.kind, t.jurisdiction).issues];
                  const blocks = issues.filter((i) => i.severity === "block").length;
                  const svg = renderLabelSvg(t.design, sampleValues(t.kind)).replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%"');
                  return (
                    <li key={t.id} className={`space-y-2 rounded-lg border p-3 ${t.archived ? "border-dashed border-slate-300 opacity-70" : "border-slate-200"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-slate-900">
                          {t.name}
                          {t.isDefault ? <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">Default</span> : null}
                          {t.archived ? <span className="ml-2 text-xs text-slate-500">archived</span> : null}
                        </p>
                        <p className="text-xs text-slate-500">
                          {sizeLabel(t.design.widthMm, t.design.heightMm)} · v{t.currentVersion}
                          {t.jurisdiction ? ` · ${t.jurisdiction} rules` : ""}
                        </p>
                      </div>
                      <div className="rounded bg-slate-100 p-2">
                        <div className="mx-auto max-w-[320px] bg-white shadow ring-1 ring-slate-300 [&>svg]:block" dangerouslySetInnerHTML={{ __html: svg }} />
                      </div>
                      <p className={`flex items-center gap-1 text-xs font-semibold ${blocks ? "text-red-700" : "text-brand-700"}`}>
                        {blocks ? <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        {blocks ? `${blocks} blocking problem${blocks === 1 ? "" : "s"} in the design. Open it to see why.` : "Design passes its checks (sample data shown)."}
                      </p>
                      {!t.archived ? (
                        <Link href={`/labels?kind=${t.kind}&template=${t.id}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-bold text-white hover:bg-brand-700">
                          <Printer className="h-4 w-4" aria-hidden="true" /> Print with this template
                        </Link>
                      ) : null}
                      {manage ? <TemplateActions id={t.id} name={t.name} kind={t.kind} isDefault={t.isDefault} archived={t.archived} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
