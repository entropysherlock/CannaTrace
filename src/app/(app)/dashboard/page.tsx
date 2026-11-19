import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Eye,
  FileText,
  FlaskConical,
  Info,
  Minus,
  ShieldCheck,
  Sparkles,
  Sprout,
  Store,
  Tag,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { and, asc, eq, or } from "drizzle-orm";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityChart } from "@/components/activity-chart";
import { Bars } from "@/components/dashboard/bars";
import { Donut } from "@/components/dashboard/donut";
import { DashboardFilters } from "@/components/dashboard/filters";
import { TallyDock, type Takeaway } from "@/components/dashboard/tally-dock";
import { SwitchBanner } from "@/components/switch-systems";
import { ShowMeHowButton } from "@/components/walkthrough";
import { facilities as facilitiesTable } from "@/db/schema";
import { commandCenter, summarize, toRange, usd } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { visibleFacilities } from "@/lib/facility-access";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { ADAPTERS } from "@/lib/sync";
import { SYSTEM_LABELS, type SystemName } from "@/lib/sync-math";
import { sweepIfStale } from "@/lib/watch";

export const metadata = { title: "Dashboard · CannaTrace" };

const num = (v: number) => v.toLocaleString("en-US");

function ago(d: Date): string {
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Delta({ value, suffix = "vs. period before" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-xs text-slate-500">no earlier period to compare</span>;
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  const tone = value > 0 ? "text-brand-700" : value < 0 ? "text-red-700" : "text-slate-500";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`inline-flex items-center gap-0.5 font-bold ${tone}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {value > 0 ? "+" : ""}
        {value}%
      </span>
      <span className="text-slate-500">{suffix}</span>
    </span>
  );
}

function Kpi({ icon: Icon, value, label, sub, href, tone = "brand" }: { icon: LucideIcon; value: string; label: string; sub: ReactNode; href: string | null; tone?: "brand" | "red" }) {
  // A tile links only to a page this person may open.
  const Box = href ? Link : "div";
  return (
    <Box
      href={href ?? ""}
      className={`flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition ${href ? "hover:border-brand-400" : ""}`}
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <Icon className={`mt-1 h-7 w-7 shrink-0 ${tone === "red" ? "text-red-600" : "text-brand-600"}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className={`block text-2xl font-extrabold tracking-tight ${tone === "red" ? "text-red-700" : "text-slate-950"}`}>{value}</span>
        <span className="block text-sm text-slate-600">{label}</span>
        <span className="mt-1 block">{sub}</span>
      </span>
    </Box>
  );
}

function Card({ title, sub, action, children, className = "" }: { title: ReactNode; sub?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-950">{title}</h2>
          {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const SEVERITY = {
  critical: { icon: XCircle, tone: "text-red-600" },
  warning: { icon: AlertTriangle, tone: "text-amber-500" },
  info: { icon: Info, tone: "text-slate-400" },
};

export default async function CommandCenterPage({ searchParams }: { searchParams: Promise<{ scope?: string; days?: string }> }) {
  const session = await requireSession();
  const zone = await facilityZone(session.facilityId);
  const params = await searchParams;
  await sweepIfStale(session);

  const facilities = visibleFacilities(
    await db
      .select({ id: facilitiesTable.id, name: facilitiesTable.name, license: facilitiesTable.licenseNumber, system: facilitiesTable.trackTraceSystem })
      .from(facilitiesTable)
      // Hidden facilities stay off the menu and Dashboard, except the one you're in.
      .where(and(eq(facilitiesTable.orgId, session.orgId), or(eq(facilitiesTable.active, true), eq(facilitiesTable.id, session.facilityId))))
      .orderBy(asc(facilitiesTable.name)),
    session,
  );
  const here = facilities.find((f) => f.id === session.facilityId) ?? facilities[0];
  const scope = params.scope === "all" && facilities.length > 1 ? "all" : "one";
  const days = toRange(params.days);
  const ids = scope === "all" ? facilities.map((f) => f.id) : [session.facilityId];
  // Alerts count only what this person may see, exactly like the bell and the Tally Watch page.
  const c = await commandCenter(session.orgId, ids, days, (permission) => !permission || can(session, permission as Parameters<typeof can>[1]));

  const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });
  const end = new Date();
  const startDay = new Date(end.getTime() - (days - 1) * 86400000);
  const span = `${fmtDay(startDay)} – ${fmtDay(end)}, ${end.toLocaleDateString("en-US", { year: "numeric", timeZone: zone })}`;

  const system = here.system as SystemName;
  const stateName = system === "MOCK" ? "Practice reporting" : SYSTEM_LABELS[system];
  const connected = system === "MOCK" || ADAPTERS[system].status().ready;
  // Practice mode sends nothing to the state: never show it as "up to date" or "all systems operational".
  const practice = facilities.some((f) => ids.includes(f.id) && f.system === "MOCK");
  const allClear = !practice && c.reporting.upToDate && c.compliance.ledgerOff === 0 && c.alerts.urgent === 0;
  const empty = c.plants.total + c.packages.total === 0;

  const takeaways: Takeaway[] = [
    { icon: c.sales.change !== null && c.sales.change < 0 ? "down" : "up", text: `Sales: ${usd(c.sales.total)}${c.sales.change !== null ? ` (${c.sales.change > 0 ? "+" : ""}${c.sales.change}%)` : ""}` },
    { icon: "packages", text: `Inventory: ${num(c.packages.total)} packages (${c.packages.availablePct}% available)` },
    { icon: "production", text: `Production: ${num(c.production.units)} units${c.production.inProgress ? `, ${c.production.inProgress} run${c.production.inProgress === 1 ? "" : "s"} going` : ""}` },
    c.alerts.open
      ? { icon: "alert", text: `Action needed: ${c.alerts.open} Tally Watch item${c.alerts.open === 1 ? "" : "s"}` }
      : { icon: "ok", text: "Tally Watch: all clear" },
  ];
  const prompts = [
    c.alerts.open ? `Show me details on the ${c.alerts.open} Tally Watch item${c.alerts.open === 1 ? "" : "s"}` : "Is anything about to go wrong?",
    "What's running low in inventory?",
    scope === "all" ? "Give me today's sales by facility" : "Give me today's sales",
    "Are we following our state's rules? What needs fixing?",
  ];

  // Each stage links to its page only when this person may open it (a budtender sees no Cultivation link).
  const allowed = (permission: Parameters<typeof can>[1], href: string) => (can(session, permission) ? href : null);
  const links = {
    cultivation: allowed("cultivation.view", "/cultivation"),
    inventory: allowed("inventory.view", "/inventory"),
    manufacturing: allowed("inventory.view", "/manufacturing"),
    distribution: allowed("sales.view", "/distribution"),
    retail: allowed("pos.use", "/pos"),
    reports: allowed("reports.view", "/reports"),
    compliance: allowed("compliance.view", "/compliance"),
  };
  const flow = [
    { icon: Sprout, label: "Cultivation", value: `${num(c.plants.total)} plants`, href: links.cultivation },
    { icon: Boxes, label: "Inventory", value: `${num(c.packages.active)} in stock`, href: links.inventory },
    { icon: FlaskConical, label: "Manufacturing", value: `${num(c.production.inProgress)} run${c.production.inProgress === 1 ? "" : "s"} going`, href: links.manufacturing },
    { icon: Truck, label: "Distribution", value: `${num(c.orders.open)} open order${c.orders.open === 1 ? "" : "s"}`, href: links.distribution },
    { icon: Store, label: "Retail", value: `${usd(c.sales.today)} today`, href: links.retail },
  ];

  const printed = c.labels.ok + c.labels.failed;
  const successRate = printed ? Math.round((c.labels.ok / printed) * 1000) / 10 : null;

  const checks = [
    {
      label: `State reporting (${stateName})`,
      ok: !practice && c.reporting.upToDate && connected,
      word: c.reporting.failed
        ? `${c.reporting.failed} failed`
        : c.reporting.pending
          ? `${c.reporting.pending} waiting`
          : practice
            ? "Practice: nothing sent"
            : connected
              ? "Up to date"
              : "Not connected",
    },
    { label: "Inventory matches its history", ok: c.compliance.ledgerOff === 0, word: c.compliance.ledgerOff ? `${c.compliance.ledgerOff} off` : "Reconciled" },
    { label: "State rules", ok: c.compliance.highIssues === 0, word: c.compliance.score === null ? "No rule pack" : `Score ${c.compliance.score}` },
    { label: "Audit trail", ok: true, word: `${num(c.compliance.auditToday)} today` },
  ];
  const compliant = checks.every((ch) => ch.ok);

  return (
    // data-wide lets the Dashboard use the full screen width instead of the usual page column.
    <div data-wide>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Your seed-to-sale operations at a glance · <span className="whitespace-nowrap">{span}</span>
          </p>
          <p className="mt-0.5 text-sm font-medium text-slate-700">
            {scope === "all" ? `All ${facilities.length} facilities` : `${here.name} · license ${here.license}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardFilters scope={scope} days={days} facilityName={here.name} facilityCount={facilities.length} />
          <ShowMeHowButton />
        </div>
      </div>

      {empty && scope === "one" && can(session, "inventory.write") && can(session, "catalog.manage") ? <SwitchBanner /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" data-testid="kpis">
        <Kpi icon={Sprout} value={num(c.plants.total)} label="Plants" href={links.cultivation} sub={<span className="text-xs text-slate-500">{num(c.plants.tagged)} tagged · {num(c.plants.young)} young</span>} />
        <Kpi
          icon={Boxes}
          value={num(c.packages.active)}
          label="Packages in stock"
          href={links.inventory}
          sub={<span className="text-xs text-slate-500">of {num(c.packages.total)} total{c.packages.held ? ` · ${num(c.packages.held)} on hold or quarantined` : ""}</span>}
        />
        <Kpi icon={Truck} value={num(c.orders.open)} label="Open wholesale orders" href={links.distribution} sub={<span className="text-xs text-slate-500">{num(c.orders.toShip)} to pick or ship</span>} />
        <Kpi icon={CircleDollarSign} value={usd(c.sales.today)} label="Sales today" href={links.reports} sub={<span className="text-xs text-slate-500">{num(c.sales.todayTickets)} sale{c.sales.todayTickets === 1 ? "" : "s"} and invoices</span>} />
        <Kpi
          icon={FileText}
          value={num(c.reporting.pending + c.reporting.failed)}
          label="Pending reports"
          href={links.compliance}
          sub={<span className={`text-xs ${c.reporting.failed ? "font-semibold text-red-700" : "text-slate-500"}`}>{c.reporting.failed ? `${c.reporting.failed} failed to send` : `to ${stateName}`}</span>}
        />
        <Kpi
          icon={AlertTriangle}
          value={num(c.alerts.open)}
          label="Alerts"
          href="/watch"
          tone={c.alerts.urgent ? "red" : "brand"}
          sub={<span className="text-xs text-slate-500">{c.alerts.urgent ? `${c.alerts.urgent} urgent` : "none urgent"} · Tally Watch</span>}
        />
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card
            title={
              <span>
                Operations flow <span className="ml-1 text-sm font-normal text-slate-500">seed-to-sale in motion</span>
              </span>
            }
            action={
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${allClear ? "bg-brand-50 text-brand-800 ring-brand-200" : "bg-amber-50 text-amber-900 ring-amber-200"}`}
              >
                {allClear ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                {allClear ? "All systems operational" : practice && c.alerts.urgent === 0 && !c.reporting.failed ? "Practice mode" : "Needs a look"}
              </span>
            }
          >
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {flow.map((f, i) => (
                <li key={f.label} className="relative">
                  {i > 0 ? <ArrowRight className="absolute -left-4 top-4 hidden h-5 w-5 -translate-x-1/2 text-slate-300 sm:block" aria-hidden="true" /> : null}
                  {(() => {
                    const inner = (
                      <>
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                          <f.icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="text-sm font-bold text-slate-900">{f.label}</span>
                        <span className="rounded-md bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{f.value}</span>
                      </>
                    );
                    return f.href ? (
                      <Link href={f.href} className="flex flex-col items-center gap-1.5 rounded-xl p-2 text-center hover:bg-brand-50">
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 p-2 text-center">{inner}</div>
                    );
                  })()}
                </li>
              ))}
            </ol>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Sales trend" sub={`Retail and wholesale, last ${days} days`} action={links.reports ? <Link href={links.reports} className="text-xs font-bold text-brand-700 hover:underline">Reports</Link> : null}>
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-2xl font-extrabold text-slate-950">{usd(c.sales.total)}</span>
                <Delta value={c.sales.change} />
              </p>
              <div className="mt-2">
                {c.sales.total > 0 ? <ActivityChart points={c.sales.points} format="money" seriesLabel="Sales" /> : <p className="py-12 text-center text-sm text-slate-500">No sales in this period yet.</p>}
              </div>
            </Card>

            <Card title="Inventory health" sub="Package status" action={links.inventory ? <Link href={links.inventory} className="text-xs font-bold text-brand-700 hover:underline">Inventory</Link> : null}>
              <div className="flex flex-1 flex-wrap items-center justify-center gap-4" data-testid="inventory-health">
                <Donut parts={c.packages.parts} total={c.packages.total} label="packages" />
                <ul className="min-w-[10rem] flex-1 space-y-2 text-sm">
                  {c.packages.parts.map((p) => (
                    <li key={p.key} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                        {p.label}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-900">{p.pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            <Card
              title="Production throughput"
              sub={`Units made by completed runs${days === 90 ? ", by week" : ""}`}
              action={<Delta value={c.production.change} suffix="" />}
            >
              {c.production.units > 0 ? (
                <Bars points={c.production.points} unit="Units made" />
              ) : (
                <p className="py-12 text-center text-sm text-slate-500">
                  No production runs finished in this period.
                </p>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Facilities and operations" sub={`${facilities.length} facilit${facilities.length === 1 ? "y" : "ies"} · last ${days} days`}>
              <ul className="space-y-2" data-testid="facility-list">
                {c.facilities.map((f) => (
                  <li key={f.id} className={`rounded-xl border px-3 py-2.5 ${f.id === session.facilityId ? "border-brand-300 bg-brand-50/50" : "border-slate-100"}`}>
                    <p className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${f.alerts ? "bg-amber-500" : "bg-brand-500"}`} aria-hidden="true" />
                        <span className="truncate text-sm font-bold text-slate-900">{f.name}</span>
                      </span>
                      {f.id === session.facilityId ? <span className="shrink-0 text-[11px] font-bold uppercase text-brand-700">You&apos;re here</span> : null}
                    </p>
                    <p className="mt-0.5 pl-4.5 text-xs text-slate-500">
                      {num(f.plants)} plants · {num(f.packages)} packages · {usd(f.sales)} sales{f.alerts ? ` · ${f.alerts} alert${f.alerts === 1 ? "" : "s"}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title={
                <span className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-red-600" aria-hidden="true" /> Tally Watch
                  {c.alerts.open ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">{c.alerts.open}</span> : null}
                </span>
              }
              sub="Things that need attention, found on their own"
            >
              {c.alerts.top.length ? (
                <ul className="divide-y divide-slate-100" data-testid="watch-top">
                  {c.alerts.top.map((a) => {
                    const st = SEVERITY[a.severity] ?? SEVERITY.info;
                    return (
                      <li key={a.id}>
                        <Link href={a.href} className="flex items-start gap-3 py-2.5 hover:bg-slate-50">
                          <st.icon className={`mt-0.5 h-5 w-5 shrink-0 ${st.tone}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-900">{a.title}</span>
                            <span className="block text-xs text-slate-500">
                              {scope === "all" ? `${a.facility} · ` : ""}
                              {ago(a.at)}
                            </span>
                          </span>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="flex flex-1 items-center gap-2 py-6 text-sm font-semibold text-brand-700">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> All clear
                </p>
              )}
              <Link href="/watch" className="mt-auto pt-2 text-sm font-bold text-brand-700 hover:underline">
                {c.alerts.open > 3 ? `View all ${c.alerts.open}` : "Open Tally Watch"} →
              </Link>
            </Card>

            <Card
              title={
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" /> SmartLabel AI
                </span>
              }
              sub={`Label printing, last ${days} days`}
            >
              <div className="flex items-center gap-4">
                <span
                  className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 ${successRate === null || successRate >= 98 ? "border-brand-500 text-brand-700" : "border-amber-400 text-amber-700"}`}
                >
                  <Tag className="h-6 w-6" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-2xl font-extrabold text-slate-950">{successRate === null ? "—" : `${successRate}%`}</p>
                  <p className="text-xs text-slate-500">{successRate === null ? "No print jobs yet" : "of print jobs went through"}</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Labels</dt>
                  <dd className="text-sm font-bold text-slate-900">{num(c.labels.labels)}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Jobs</dt>
                  <dd className="text-sm font-bold text-slate-900">{num(c.labels.jobs)}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Templates</dt>
                  <dd className="text-sm font-bold text-slate-900">{num(c.labels.templates)}</dd>
                </div>
              </dl>
              <Link
                href={c.labels.failed ? "/labels/history" : "/labels"}
                className={`mt-auto flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${c.labels.failed ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-800"}`}
              >
                <span className="flex items-center gap-2">
                  {c.labels.failed ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  {c.labels.failed ? `${c.labels.failed} print job${c.labels.failed === 1 ? "" : "s"} failed` : "All label queues are clear"}
                </span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title={
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden="true" /> Compliance status
                </span>
              }
              sub="State reporting and audit readiness"
            >
              <div className="flex flex-wrap items-center gap-5" data-testid="compliance-status">
                <div className="flex items-center gap-3">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full ${compliant ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-700"}`}>
                    {compliant ? <CheckCircle2 className="h-7 w-7" aria-hidden="true" /> : <AlertTriangle className="h-7 w-7" aria-hidden="true" />}
                  </span>
                  <div>
                    <p className="text-lg font-extrabold text-slate-950">{compliant ? "Compliant" : "Needs a look"}</p>
                    <p className="text-xs text-slate-500">{compliant ? "Reporting, records, and rules in order" : "Open Compliance to see what to fix"}</p>
                  </div>
                </div>
                <ul className="min-w-[14rem] flex-1 space-y-1.5 text-sm">
                  {checks.map((ch) => (
                    <li key={ch.label} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-slate-700">
                        {ch.ok ? <CheckCircle2 className="h-4 w-4 text-brand-600" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />}
                        {ch.label}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ch.ok ? "bg-brand-50 text-brand-800" : "bg-amber-50 text-amber-900"}`}>{ch.word}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {c.compliance.issues.length ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">What to fix</p>
                  <ul className="space-y-1">
                    {c.compliance.issues.map((i) => (
                      <li key={i.id}>
                        <Link href={i.href} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                          <span className="flex min-w-0 items-center gap-2 text-slate-800">
                            {i.severity === "high" ? <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />}
                            {i.title}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>

            <Card
              title={
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" /> Recent activity
                </span>
              }
              sub={scope === "all" ? "Across your facilities" : `At ${here.name}`}
              action={
                can(session, "audit.view") ? (
                  <Link href="/audit" className="text-xs font-bold text-brand-700 hover:underline">
                    View all →
                  </Link>
                ) : null
              }
            >
              {c.activity.length ? (
                <ul className="space-y-2" data-testid="recent-activity">
                  {c.activity.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block truncate text-slate-800">{a.text}</span>
                          <span className="block text-xs text-slate-500">
                            {a.who}
                            {scope === "all" && a.facility ? ` · ${a.facility}` : ""}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">{ago(a.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-sm text-slate-500">Nothing recorded yet.</p>
              )}
            </Card>
          </div>
        </div>

        <div className="2xl:sticky 2xl:top-20 2xl:self-start">
          <TallyDock name={session.name.split(" ")[0]} summary={summarize(c)} takeaways={takeaways} prompts={prompts} />
        </div>
      </div>
    </div>
  );
}
