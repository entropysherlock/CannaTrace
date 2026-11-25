import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { AskAboutButton } from "@/components/assistant-panel";
import { Card, PageHeader } from "@/components/ui";
import { ENFORCEMENT, PACKS } from "@/lib/rules";
import { scanFacility, type Issue } from "@/lib/rules/scan";
import { requirePagePermission } from "@/lib/session";

const SEVERITY: Record<
  Issue["severity"],
  { icon: typeof Info; tone: string; label: string }
> = {
  high: {
    icon: ShieldAlert,
    tone: "border-red-200 bg-red-50 text-red-900",
    label: "Fix now",
  },
  medium: {
    icon: AlertTriangle,
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    label: "Needs attention",
  },
  info: {
    icon: Info,
    tone: "border-slate-200 bg-slate-50 text-slate-800",
    label: "For your information",
  },
};

const date = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export default async function StateRulesPage() {
  const session = await requirePagePermission("compliance.view");
  const { pack, state, issues, score } = await scanFacility(
    session.orgId,
    session.facilityId,
  );
  const scoreTone =
    score >= 90
      ? "text-brand-700"
      : score >= 70
        ? "text-amber-700"
        : "text-red-700";

  return (
    <>
      <PageHeader
        title="State rules"
        subtitle={
          pack
            ? `${pack.name} rules Leaf2Sale checks for this facility, with where each one comes from.`
            : `Rules for ${state || "this facility's state"}.`
        }
        action={
          <AskAboutButton
            prompt="Explain this facility's compliance issues and how to fix each one."
            label="Ask the assistant"
          />
        }
      />

      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-600">
              Compliance score
            </p>
            <p
              className={`mt-1 text-5xl font-bold tracking-tight ${scoreTone}`}
            >
              {score}
              <span className="text-xl font-semibold text-slate-400">/100</span>
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {issues.filter((i) => i.severity !== "info").length === 0
                ? "Nothing needs fixing right now."
                : `${issues.filter((i) => i.severity !== "info").length} to fix.`}{" "}
              Checked every time you open this page.
            </p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            {pack ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">State</dt>
                  <dd className="font-medium text-slate-900">{pack.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Regulator</dt>
                  <dd>
                    <a
                      href={pack.regulator.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                    >
                      {pack.regulator.name}{" "}
                      <ExternalLink
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">State tracking system</dt>
                  <dd className="font-medium text-slate-900">
                    {pack.trackingSystem}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Rules last reviewed</dt>
                  <dd className="font-medium text-slate-900">
                    {date(pack.reviewed)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">What this covers</dt>
                  <dd className="text-slate-700">{pack.coverage}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-slate-700">
                Leaf2Sale has rule packs for{" "}
                {Object.values(PACKS)
                  .map((p) => p.name)
                  .join(", ")}{" "}
                so far. This facility is in{" "}
                {state || "a state we don&apos;t have yet"}, so only your
                store&apos;s own settings and the checks every state shares are
                applied.
              </p>
            )}
          </section>
        </div>

        <Card title="To fix">
          {issues.length ? (
            <ul className="space-y-3">
              {issues.map((issue) => {
                const { icon: Icon, tone, label } = SEVERITY[issue.severity];
                return (
                  <li
                    key={issue.id}
                    className={`rounded-lg border p-4 ${tone}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <Icon
                          className="mt-0.5 h-5 w-5 shrink-0"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold">{issue.title}</p>
                          <p className="mt-1 text-sm opacity-90">
                            {issue.detail}
                          </p>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                            {label}
                          </p>
                        </div>
                      </div>
                      {issue.fix ? (
                        <Link
                          href={issue.fix.href}
                          className="shrink-0 rounded-lg border border-current/20 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          {issue.fix.label}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Nothing to
              fix. Every check passed.
            </p>
          )}
        </Card>

        {pack ? (
          <Card title={`${pack.name} rules in effect`}>
            <ul className="divide-y divide-slate-100">
              {pack.rules.map((rule) => (
                <li
                  key={rule.id}
                  className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:gap-6"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                    {rule.title}
                    {rule.kind === "PURCHASE_LIMIT" && rule.period === "DAY" ? (
                      <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Per day: checked on each sale</span>
                    ) : null}
                  </p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {rule.summary}
                    </p>
                    <a
                      href={rule.source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                    >
                      {rule.source.citation}{" "}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                    <span className="ml-2 text-xs text-slate-400">
                      checked {date(rule.source.checked)}
                    </span>
                  </div>
                  <span
                    className={`h-fit w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${rule.kind === "REFERENCE" ? "bg-slate-100 text-slate-600" : "bg-brand-50 text-brand-800"}`}
                  >
                    {ENFORCEMENT[rule.kind]}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900 mt-3"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Leaf2Sale is not a lawyer. Rules change; check anything important
              with your regulator. Tell us if a rule looks out of date.</span></p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
