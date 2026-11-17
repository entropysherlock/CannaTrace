import { AlertOctagon, AlertTriangle, CheckCircle2, ExternalLink, Info } from "lucide-react";
import type { LabelIssue } from "@/lib/labels/types";

const CATEGORY: Record<LabelIssue["category"], string> = {
  MISSING_DATA: "Missing data",
  INCONSISTENT_DATA: "Data that doesn't add up",
  BARCODE: "Barcodes",
  LAYOUT: "Layout",
  JURISDICTION: "State label rules",
};

const ORDER: LabelIssue["category"][] = ["MISSING_DATA", "INCONSISTENT_DATA", "BARCODE", "LAYOUT", "JURISDICTION"];

export type PackInfo = { state: string; name: string; source: string; url: string; checked: string } | null;

function Icon({ severity }: { severity: LabelIssue["severity"] }) {
  if (severity === "block") return <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="Blocks printing" />;
  if (severity === "warn") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="Warning" />;
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-label="Note" />;
}

/** The checker's findings, grouped so missing data, contradictions, and rule gaps read differently. */
export function IssueList({
  issues,
  blocked,
  pack,
  checkedRules,
  manualRules,
  count,
}: {
  issues: LabelIssue[];
  blocked: boolean;
  pack: PackInfo;
  checkedRules: number;
  manualRules: number;
  count?: number;
}) {
  const blocks = issues.filter((i) => i.severity === "block").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  // Many labels often share one problem; show each message once with a count.
  const grouped = ORDER.map((cat) => {
    const seen = new Map<string, { issue: LabelIssue; n: number }>();
    for (const i of issues.filter((x) => x.category === cat)) {
      const key = `${i.code}|${i.elementId ?? ""}|${i.message.replace(/^[^:]*: /, "")}`;
      const hit = seen.get(key);
      if (hit) hit.n++;
      else seen.set(key, { issue: i, n: 1 });
    }
    return { cat, rows: [...seen.values()].sort((a, b) => sev(a.issue) - sev(b.issue)) };
  }).filter((g) => g.rows.length);

  return (
    <div className="space-y-3" data-testid="label-issues">
      <div className={`flex items-start gap-2 rounded-lg border-l-4 px-3 py-2 text-sm font-semibold ${blocked ? "border-red-600 bg-red-50 text-red-900" : "border-brand-600 bg-brand-50 text-brand-900"}`}>
        {blocked ? <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        <p>
          {blocked
            ? `Can't print yet: ${blocks} blocking problem${blocks === 1 ? "" : "s"}${warns ? ` and ${warns} warning${warns === 1 ? "" : "s"}` : ""}.`
            : `No blocking problems${count ? ` in ${count} label${count === 1 ? "" : "s"}` : ""}${warns ? `, ${warns} warning${warns === 1 ? "" : "s"} to look at` : ""}.`}
        </p>
      </div>
      {pack ? (
        <p className="text-xs text-slate-600">
          {checkedRules ? `Checked ${checkedRules} ${pack.state} rules automatically` : `No ${pack.state} rules apply to this label type`}
          {manualRules ? `; ${manualRules} more need a person to confirm` : ""}. Source:{" "}
          <a href={pack.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-brand-700 underline">
            {pack.source} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          , read {pack.checked}. These checks help catch mistakes; they don&apos;t certify a label as compliant.
        </p>
      ) : (
        <p className="text-xs text-slate-600">These checks help catch mistakes; they don&apos;t certify a label as compliant.</p>
      )}
      {grouped.map((g) => (
        <div key={g.cat}>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{CATEGORY[g.cat]}</p>
          <ul className="space-y-1.5">
            {g.rows.map(({ issue, n }, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-slate-800">
                <Icon severity={issue.severity} />
                <div className="min-w-0">
                  <p>
                    {n > 1 ? issue.message.replace(/^[^:]*: /, "") : issue.message}
                    {n > 1 ? <span className="ml-1 font-semibold text-slate-500">({n} labels)</span> : null}
                    {issue.citation ? <span className="ml-1 text-xs text-slate-500">{issue.citation}</span> : null}
                  </p>
                  {issue.fix ? <p className="text-xs text-slate-600">{issue.fix}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const sev = (i: LabelIssue) => (i.severity === "block" ? 0 : i.severity === "warn" ? 1 : 2);
