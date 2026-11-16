import { AlertTriangle, Boxes, CheckCircle2, CircleDollarSign, Factory, Leaf, Sprout, XCircle, type LucideIcon } from "lucide-react";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import Link from "next/link";
import { ActivityChart } from "@/components/activity-chart";
import { usd } from "@/components/distribution-ui";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { ADAPTERS } from "@/lib/sync";
import { SYSTEM_LABELS, type SystemName } from "@/lib/sync-math";

type Row = Record<string, string | number | null>;
const q = async (query: ReturnType<typeof sql>) => (await db.execute<Row>(query)).rows;
const n = (v: unknown) => Number(v ?? 0);

function StatCard({ icon: Icon, label, value, sub, href }: { icon: LucideIcon; label: string; value: string; sub: string; href: string }) {
  return (
    <Link href={href} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-500">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tracking-tight text-slate-900">{value}</span>
        <span className="block text-sm text-slate-600">{label}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </Link>
  );
}

type Level = "good" | "warn" | "bad";
const LEVEL: Record<Level, { icon: LucideIcon; tone: string }> = {
  good: { icon: CheckCircle2, tone: "text-brand-700" },
  warn: { icon: AlertTriangle, tone: "text-amber-700" },
  bad: { icon: XCircle, tone: "text-red-700" },
};

function StatusRow({ label, level, text }: { label: string; level: Level; text: string }) {
  const { icon: Icon, tone } = LEVEL[level];
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-slate-800">
        <Icon className={`h-5 w-5 ${tone}`} aria-hidden="true" />
        {label}
      </span>
      <span className={`font-medium ${tone}`}>{text}</span>
    </li>
  );
}

export default async function DashboardPage() {
  const session = await requireSession();
  const org = session.orgId;
  const fac = session.facilityId;

  const [[facility], [counts], salesDays, activityDays, [sync], [ledger], [audit], [topGroup], [flow]] = await Promise.all([
    q(sql`select name, license_number, track_trace_system from facilities where id = ${fac}`),
    q(sql`select
        (select count(*) from plants where org_id = ${org} and facility_id = ${fac} and status = 'ACTIVE') as plants,
        (select coalesce(sum(untagged_count), 0) from plant_batches where org_id = ${org} and facility_id = ${fac} and status = 'ACTIVE') as untagged,
        (select count(*) from packages where org_id = ${org} and facility_id = ${fac} and status in ('ACTIVE','ALLOCATED')) as packages,
        (select count(*) from packages where org_id = ${org} and facility_id = ${fac} and status in ('ON_HOLD','QUARANTINE')) as held,
        (select count(*) from harvests where org_id = ${org} and facility_id = ${fac} and status = 'DRYING') as drying,
        (select count(*) from production_runs where org_id = ${org} and facility_id = ${fac} and status = 'IN_PROGRESS') as runs`),
    q(sql`
      with days as (select generate_series((now() at time zone 'America/Denver')::date - 29, (now() at time zone 'America/Denver')::date, '1 day')::date as day),
      money as (
        select (completed_at at time zone 'America/Denver')::date as day, total as amount
          from sales where org_id = ${org} and facility_id = ${fac} and status = 'COMPLETED' and completed_at > now() - interval '31 days'
        union all
        select (created_at at time zone 'America/Denver')::date, total
          from invoices where org_id = ${org} and facility_id = ${fac} and created_at > now() - interval '31 days'
      )
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(m.amount), 0) as value
      from days d left join money m on m.day = d.day group by d.day order by d.day`),
    q(sql`
      with days as (select generate_series((now() at time zone 'America/Denver')::date - 29, (now() at time zone 'America/Denver')::date, '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as day, count(t.id) as value
      from days d left join inventory_transactions t
        on (t.created_at at time zone 'America/Denver')::date = d.day and t.org_id = ${org} and t.facility_id = ${fac}
      group by d.day order by d.day`),
    q(sql`select
        count(*) filter (where status = 'FAILED') as failed,
        count(*) filter (where status = 'MANUAL') as manual,
        count(*) filter (where status = 'PENDING') as pending
      from sync_events where org_id = ${org} and facility_id = ${fac}`),
    q(sql`select count(*) as off from (
        select p.id from packages p join inventory_transactions t on t.package_id = p.id
        where p.org_id = ${org} and p.facility_id = ${fac}
        group by p.id, p.quantity having sum(t.quantity_delta) <> p.quantity) x`),
    q(sql`select count(*) as today from audit_logs where org_id = ${org} and facility_id = ${fac} and created_at > now() - interval '1 day'`),
    q(sql`select s.name as strain, l.name as room, p.phase, count(*) as plants, floor(extract(epoch from now() - min(p.phase_changed_at)) / 604800)::int + 1 as weeks
      from plants p join strains s on s.id = p.strain_id join locations l on l.id = p.location_id
      where p.org_id = ${org} and p.facility_id = ${fac} and p.status = 'ACTIVE'
      group by s.name, l.name, p.phase order by count(*) desc limit 1`),
    q(sql`select
        (select count(*) from packages where org_id = ${org} and facility_id = ${fac} and created_at > now() - interval '7 days') as packaged_week,
        (select count(*) from orders where org_id = ${org} and facility_id = ${fac} and status in ('CONFIRMED','PACKED','SHIPPED')) as open_orders,
        (select count(*) from sales where org_id = ${org} and facility_id = ${fac} and status = 'COMPLETED' and completed_at > now() - interval '1 day') as sales_today`),
  ]);

  const salesPoints = salesDays.map((r) => ({ day: String(r.day), value: n(r.value) }));
  const salesTotal = salesPoints.reduce((s, p) => s.add(p.value), new Decimal(0));
  const useSales = salesTotal.gt(0);
  const points = useSales ? salesPoints : activityDays.map((r) => ({ day: String(r.day), value: n(r.value) }));
  const activityTotal = activityDays.reduce((s, r) => s + n(r.value), 0);

  const system = String(facility.track_trace_system) as SystemName;
  const connection = ADAPTERS[system].status();
  const reportingLevel: Level = n(sync.failed) ? "bad" : n(sync.manual) ? "warn" : "good";
  const reportingText = n(sync.failed)
    ? `${n(sync.failed)} failed`
    : n(sync.manual)
      ? `${n(sync.manual)} to enter by hand`
      : n(sync.pending)
        ? `${n(sync.pending)} waiting to send`
        : "Up to date";

  const weeks = topGroup ? n(topGroup.weeks) : 0;
  const stages = [
    { label: "Cultivate", count: n(counts.plants) + n(counts.untagged), unit: "plants", href: "/cultivation" },
    { label: "Harvest", count: n(counts.drying), unit: "drying", href: "/cultivation/harvests" },
    { label: "Manufacture", count: n(counts.runs), unit: "in progress", href: "/manufacturing" },
    { label: "Package", count: n(flow.packaged_week), unit: "this week", href: "/inventory" },
    { label: "Distribute", count: n(flow.open_orders), unit: "open orders", href: "/distribution" },
    { label: "Retail", count: n(flow.sales_today), unit: "sales today", href: "/pos" },
  ];

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          {String(facility.name)} · license {String(facility.license_number)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Sprout}
          label="Plants growing"
          value={(n(counts.plants) + n(counts.untagged)).toLocaleString("en-US")}
          sub={`${n(counts.plants).toLocaleString("en-US")} tagged · ${n(counts.untagged).toLocaleString("en-US")} young`}
          href="/cultivation"
        />
        <StatCard
          icon={Boxes}
          label="Packages in stock"
          value={n(counts.packages).toLocaleString("en-US")}
          sub={n(counts.held) ? `${n(counts.held)} on hold or quarantined` : "none on hold"}
          href="/inventory"
        />
        <StatCard
          icon={Factory}
          label="Harvests and runs in progress"
          value={(n(counts.drying) + n(counts.runs)).toLocaleString("en-US")}
          sub={`${n(counts.drying)} drying · ${n(counts.runs)} production runs`}
          href="/manufacturing"
        />
        <StatCard icon={CircleDollarSign} label="Sales, last 30 days" value={usd(salesTotal)} sub="retail and wholesale" href="/reports" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:col-span-2">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">{useSales ? "Sales by day" : "Inventory activity by day"}</h2>
            <p className="text-sm text-slate-500">Last 30 days</p>
          </div>
          {useSales || activityTotal > 0 ? (
            <ActivityChart points={points} format={useSales ? "money" : "count"} seriesLabel={useSales ? "Sales" : "Inventory records"} />
          ) : (
            <p className="py-16 text-center text-sm text-slate-500">Nothing recorded yet. Receive a package or make a sale and it will show here.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Compliance status</h2>
            <Link href="/compliance" className="text-sm font-semibold text-brand-700 hover:underline">
              Details
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            <StatusRow label="State reporting" level={reportingLevel} text={reportingText} />
            <StatusRow
              label={SYSTEM_LABELS[system].replace(" (nothing is sent)", "")}
              level={system === "MOCK" ? "warn" : connection.ready ? "good" : "bad"}
              text={system === "MOCK" ? "Practice only" : connection.ready ? "Set up" : "Not connected"}
            />
            <StatusRow
              label="Inventory reconciliation"
              level={n(ledger.off) ? "bad" : "good"}
              text={n(ledger.off) ? `${n(ledger.off)} packages off` : "No issues"}
            />
            <StatusRow label="Audit trail" level="good" text={`${n(audit.today)} entries today`} />
          </ul>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Plant tracking</h2>
          {topGroup ? (
            <Link href="/cultivation/plants" className="flex items-center gap-4 rounded-lg p-1 hover:bg-brand-50">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-900 text-brand-100">
                <Leaf className="h-8 w-8" aria-hidden="true" />
              </span>
              <span className="min-w-0 text-sm">
                <span className="block font-semibold text-slate-900">{String(topGroup.strain)}</span>
                <span className="block text-slate-600">
                  {String(topGroup.phase) === "FLOWERING" ? "Flowering" : "Vegetative"} · {String(topGroup.room)}
                </span>
                <span className="block font-medium text-brand-700">
                  {n(topGroup.plants)} plants · week {weeks}
                </span>
              </span>
            </Link>
          ) : (
            <p className="text-sm text-slate-500">No tagged plants at this facility.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Workflow</h2>
          <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
            {stages.map((stage, i) => (
              <li key={stage.label} className="relative text-center">
                {i > 0 ? <span className="absolute right-1/2 top-2.5 hidden h-0.5 w-full bg-slate-200 sm:block" aria-hidden="true" /> : null}
                <Link href={stage.href} className="relative flex flex-col items-center gap-1 hover:text-brand-700">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      stage.count > 0 ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white"
                    }`}
                  >
                    {stage.count > 0 ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  </span>
                  <span className="text-xs font-semibold text-slate-800">{stage.label}</span>
                  <span className="text-xs text-slate-500">
                    {stage.count.toLocaleString("en-US")} {stage.unit}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
