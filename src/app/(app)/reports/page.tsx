import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import Link from "next/link";
import { usd } from "@/components/distribution-ui";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";

type Row = Record<string, string | number | null>;
const rows = async (query: ReturnType<typeof sql>) => (await db.execute<Row>(query)).rows;
const dec = (v: unknown) => new Decimal(String(v ?? 0));
const pct = (v: Decimal | null) => (v === null ? "n/a" : `${v.toDecimalPlaces(1).toString()}%`);

function Table({ head, body, empty }: { head: string[]; body: (string | number)[][]; empty: string }) {
  if (body.length === 0) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-600">
            {head.map((h, i) => (
              <th key={h} className={`py-2 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-0">
              {r.map((cell, ci) => (
                <td key={ci} className={`py-2 pr-3 ${ci > 0 ? "text-right tabular-nums" : "text-slate-900"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportsPage() {
  const session = await requirePagePermission("reports.view");
  const org = session.orgId;
  const fac = session.facilityId;
  const onHand = sql`p.org_id = ${org} and p.facility_id = ${fac} and p.status in ('ACTIVE','ALLOCATED','ON_HOLD','QUARANTINE')`;

  const [value, aging, retail, wholesale, harvestYield, runYield, sync] = await Promise.all([
    rows(sql`
      select c.name as category, count(*)::int as packages,
             coalesce(sum(p.quantity * p.cost_per_unit), 0) as value,
             count(*) filter (where p.cost_per_unit is null)::int as uncosted
      from packages p join items i on i.id = p.item_id join item_categories c on c.id = i.category_id
      where ${onHand} group by c.name order by value desc`),
    rows(sql`
      select case when now() - p.created_at < interval '31 days' then '0 to 30 days'
                  when now() - p.created_at < interval '61 days' then '31 to 60 days'
                  when now() - p.created_at < interval '91 days' then '61 to 90 days'
                  else 'Over 90 days' end as bucket,
             min(p.created_at) as oldest, count(*)::int as packages,
             coalesce(sum(p.quantity * p.cost_per_unit), 0) as value
      from packages p where ${onHand} group by 1 order by oldest desc`),
    rows(sql`
      select to_char(date_trunc('day', completed_at at time zone 'America/Denver'), 'YYYY-MM-DD') as day,
             count(*)::int as sales, sum(total) as total, sum(discount_total) as discounts,
             sum(excise_tax + sales_tax) as tax
      from sales where org_id = ${org} and facility_id = ${fac} and status = 'COMPLETED'
        and completed_at > now() - interval '30 days'
      group by 1 order by 1 desc`),
    rows(sql`
      select coalesce(sum(i.total) filter (where i.created_at > now() - interval '30 days'), 0) as invoiced_30,
             coalesce(sum(i.total - coalesce(p.paid, 0)), 0) as outstanding,
             coalesce(sum(i.total - coalesce(p.paid, 0)) filter (where i.due_date < to_char(now() at time zone 'America/Denver', 'YYYY-MM-DD')), 0) as overdue
      from invoices i left join (select invoice_id, sum(amount) as paid from payments group by invoice_id) p on p.invoice_id = i.id
      where i.org_id = ${org} and i.facility_id = ${fac}`),
    rows(sql`
      select h.name, s.name as strain, h.plant_count, h.wet_weight, h.dry_weight, h.packaged_weight, h.waste_weight
      from harvests h join strains s on s.id = h.strain_id
      where h.org_id = ${org} and h.facility_id = ${fac} and h.status = 'FINISHED' and h.finished_at > now() - interval '90 days'
      order by h.finished_at desc limit 20`),
    rows(sql`
      select r.name, b.name as recipe, r.planned_output, r.actual_output, r.cost_per_unit
      from production_runs r join boms b on b.id = r.bom_id
      where r.org_id = ${org} and r.facility_id = ${fac} and r.status = 'COMPLETED' and r.completed_at > now() - interval '90 days'
      order by r.completed_at desc limit 20`),
    rows(sql`
      select status, count(*)::int as n, min(created_at) as oldest
      from sync_events where org_id = ${org} and facility_id = ${fac} and status in ('PENDING','FAILED','MANUAL')
      group by status`),
  ]);

  const totalValue = value.reduce((s, r) => s.add(dec(r.value)), new Decimal(0));
  const uncosted = value.reduce((s, r) => s + Number(r.uncosted), 0);
  const retailTotal = retail.reduce((s, r) => s.add(dec(r.total)), new Decimal(0));
  const syncCount = (status: string) => Number(sync.find((r) => r.status === status)?.n ?? 0);
  const [w] = wholesale;

  const tiles = [
    { label: "Inventory value at cost", value: usd(totalValue), sub: uncosted ? `${uncosted} package${uncosted === 1 ? " has" : "s have"} no cost` : "every package has a cost" },
    { label: "Retail sales, last 30 days", value: usd(retailTotal), sub: `${retail.reduce((s, r) => s + Number(r.sales), 0)} sales` },
    { label: "Owed to you (wholesale)", value: usd(dec(w?.outstanding)), sub: dec(w?.overdue).gt(0) ? `${usd(dec(w?.overdue))} overdue` : "nothing overdue" },
    {
      label: "State reporting",
      value: syncCount("FAILED") + syncCount("MANUAL") === 0 ? "Healthy" : `${syncCount("FAILED") + syncCount("MANUAL")} need attention`,
      sub: `${syncCount("PENDING")} waiting to send`,
      href: "/compliance",
    },
  ];

  return (
    <>
      <PageHeader title="Reports" subtitle="This facility at a glance. Figures update as you work." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <>
              <p className="text-sm text-slate-600">{t.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{t.value}</p>
              <p className="text-sm text-slate-500">{t.sub}</p>
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-500">
              {body}
            </Link>
          ) : (
            <div key={t.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              {body}
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Inventory value by category">
          <Table
            head={["Category", "Packages", "Value at cost"]}
            body={value.map((r) => [String(r.category), Number(r.packages), usd(dec(r.value))])}
            empty="No stock on hand."
          />
        </Card>
        <Card title="Inventory age">
          <Table
            head={["Age", "Packages", "Value at cost"]}
            body={aging.map((r) => [String(r.bucket), Number(r.packages), usd(dec(r.value))])}
            empty="No stock on hand."
          />
        </Card>
        <Card title="Retail sales by day (last 30 days)">
          <Table
            head={["Day", "Sales", "Discounts", "Tax", "Total"]}
            body={retail.map((r) => [String(r.day), Number(r.sales), usd(dec(r.discounts)), usd(dec(r.tax)), usd(dec(r.total))])}
            empty="No retail sales in the last 30 days at this facility."
          />
        </Card>
        <Card title="Wholesale">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-600">Invoiced, last 30 days</dt>
            <dd className="text-right font-semibold">{usd(dec(w?.invoiced_30))}</dd>
            <dt className="text-slate-600">Still owed</dt>
            <dd className="text-right font-semibold">{usd(dec(w?.outstanding))}</dd>
            <dt className="text-slate-600">Overdue</dt>
            <dd className={`text-right font-semibold ${dec(w?.overdue).gt(0) ? "text-red-700" : ""}`}>{usd(dec(w?.overdue))}</dd>
          </dl>
          <Link href="/distribution/invoices" className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline">
            Open invoices
          </Link>
        </Card>
        <Card title="Harvest yields (last 90 days)">
          <Table
            head={["Harvest", "Plants", "Dry ÷ wet", "Packaged per plant"]}
            body={harvestYield.map((r) => [
              `${r.name} · ${r.strain}`,
              Number(r.plant_count),
              r.dry_weight ? pct(dec(r.dry_weight).div(dec(r.wet_weight)).mul(100)) : "n/a",
              `${dec(r.packaged_weight).div(Number(r.plant_count) || 1).toDecimalPlaces(1).toString()} g`,
            ])}
            empty="No harvests finished in the last 90 days."
          />
        </Card>
        <Card title="Production yields (last 90 days)">
          <Table
            head={["Run", "Planned", "Made", "Yield", "Cost each"]}
            body={runYield.map((r) => [
              `${r.name} · ${r.recipe}`,
              dec(r.planned_output).toString(),
              dec(r.actual_output).toString(),
              pct(dec(r.planned_output).gt(0) ? dec(r.actual_output).div(dec(r.planned_output)).mul(100) : null),
              r.cost_per_unit ? usd(dec(r.cost_per_unit)) : "unknown",
            ])}
            empty="No production runs completed in the last 90 days."
          />
        </Card>
      </div>
      <p className="mt-5 text-sm text-slate-600">
        Need the raw numbers? Download them as spreadsheets from{" "}
        <Link href="/data" className="font-semibold text-emerald-700 hover:underline">
          Import and export
        </Link>
        .
      </p>
    </>
  );
}
