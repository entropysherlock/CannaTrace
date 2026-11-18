import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { scanFacility } from "@/lib/rules/scan";

/**
 * Everything on the Command Center (the dashboard), for one facility or every facility in the business,
 * over the last 7, 30, or 90 days. Days are counted in Mountain time, where New Mexico facilities are.
 */

export type Range = 7 | 30 | 90;
export const RANGES: Range[] = [7, 30, 90];
export const toRange = (v: unknown): Range => (RANGES.includes(Number(v) as Range) ? (Number(v) as Range) : 30);

type Row = Record<string, string | number | null>;
const q = async (query: ReturnType<typeof sql>) => (await db.execute<Row>(query)).rows;
const n = (v: unknown) => Number(v ?? 0);
const TZ = "America/Denver";

/** Percent change from the earlier period to this one; null when there's nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** A plain-words summary of the numbers, for the Tally panel. No AI call: it's the same every time for the same numbers. */
export function summarize(c: Pick<CommandCenter, "days" | "sales" | "packages" | "production" | "alerts">): string {
  const parts: string[] = [];
  const pct = (v: number | null) => (v === null ? "" : ` (${v >= 0 ? "up" : "down"} ${Math.abs(v)}% on the period before)`);
  parts.push(c.sales.total > 0 ? `Sales over the last ${c.days} days are ${usd(c.sales.total)}${pct(c.sales.change)}.` : `No sales recorded in the last ${c.days} days.`);
  if (c.packages.total) parts.push(`${c.packages.availablePct}% of ${c.packages.total.toLocaleString("en-US")} packages are available to sell.`);
  if (c.production.units > 0) parts.push(`Production made ${c.production.units.toLocaleString("en-US")} units${pct(c.production.change)}.`);
  parts.push(
    c.alerts.open
      ? `Tally Watch has ${c.alerts.open} item${c.alerts.open === 1 ? "" : "s"} to look at${c.alerts.urgent ? `, ${c.alerts.urgent} urgent` : ""}.`
      : "Tally Watch found nothing that needs attention.",
  );
  return parts.join(" ");
}

export const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export type CommandCenter = Awaited<ReturnType<typeof commandCenter>>;

/**
 * One definition per number, shared by every card, the facility list, and Tally's summary:
 * plants are tagged plants plus young (untagged) plants in active batches; sales are completed register
 * sales plus invoices, by Mountain-time day; alerts are open Tally Watch items this person may see (canSee
 * is the same test the bell and the Tally Watch page use).
 */
export async function commandCenter(orgId: string, facilityIds: string[], days: Range, canSee: (permission: string | null) => boolean = () => true) {
  const ids = facilityIds;
  // The facilities as one Postgres array (ids are UUIDs, so a comma can't appear inside one).
  const inIds = sql`string_to_array(${ids.join(",")}, ',')`;
  const start = sql`(now() at time zone ${TZ})::date - ${days - 1}::int`;
  const prevStart = sql`(now() at time zone ${TZ})::date - ${2 * days - 1}::int`;
  const local = (col: ReturnType<typeof sql>) => sql`(${col} at time zone ${TZ})::date`;

  const [
    [stock],
    salesDays,
    [salesPrev],
    [today],
    statuses,
    prodDays,
    [prodPrev],
    [sync],
    [ledger],
    [audit],
    [labels],
    findings,
    activity,
    perFacility,
    [orders],
  ] = await Promise.all([
    q(sql`select
        (select count(*) from plants where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'ACTIVE') as plants,
        (select coalesce(sum(untagged_count), 0) from plant_batches where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'ACTIVE') as young,
        (select count(*) from harvests where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'DRYING') as drying,
        (select count(*) from production_runs where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'IN_PROGRESS') as runs`),
    q(sql`
      with days as (select generate_series(${start}, (now() at time zone ${TZ})::date, '1 day')::date as day),
      money as (
        select ${local(sql`completed_at`)} as day, total as amount from sales
          where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'COMPLETED' and completed_at > now() - make_interval(days => ${days + 1})
        union all
        select ${local(sql`created_at`)}, total from invoices
          where org_id = ${orgId} and facility_id = any(${inIds}) and created_at > now() - make_interval(days => ${days + 1})
      )
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(m.amount), 0) as value
      from days d left join money m on m.day = d.day group by d.day order by d.day`),
    q(sql`select coalesce(sum(amount), 0) as total from (
        select total as amount, ${local(sql`completed_at`)} as day from sales where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'COMPLETED'
        union all
        select total, ${local(sql`created_at`)} from invoices where org_id = ${orgId} and facility_id = any(${inIds})
      ) m where m.day >= ${prevStart} and m.day < ${start}`),
    q(sql`select coalesce(sum(amount), 0) as total, count(*) as tickets from (
        select total as amount from sales where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'COMPLETED'
          and ${local(sql`completed_at`)} = (now() at time zone ${TZ})::date
        union all
        select total from invoices where org_id = ${orgId} and facility_id = any(${inIds}) and ${local(sql`created_at`)} = (now() at time zone ${TZ})::date
      ) m`),
    q(sql`select status, count(*) as n from packages where org_id = ${orgId} and facility_id = any(${inIds})
        and status in ('ACTIVE','ALLOCATED','ON_HOLD','QUARANTINE') group by status`),
    q(sql`
      with days as (select generate_series(${start}, (now() at time zone ${TZ})::date, '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(r.actual_output), 0) as value
      from days d left join production_runs r on ${local(sql`r.completed_at`)} = d.day and r.org_id = ${orgId} and r.facility_id = any(${inIds}) and r.status = 'COMPLETED'
      group by d.day order by d.day`),
    q(sql`select coalesce(sum(actual_output), 0) as units from production_runs
        where org_id = ${orgId} and facility_id = any(${inIds}) and status = 'COMPLETED'
        and ${local(sql`completed_at`)} >= ${prevStart} and ${local(sql`completed_at`)} < ${start}`),
    q(sql`select
        count(*) filter (where status = 'FAILED') as failed,
        count(*) filter (where status = 'MANUAL') as manual,
        count(*) filter (where status = 'PENDING') as pending
      from sync_events where org_id = ${orgId} and facility_id = any(${inIds})`),
    q(sql`select count(*) as off from (
        select p.id from packages p join inventory_transactions t on t.package_id = p.id
        where p.org_id = ${orgId} and p.facility_id = any(${inIds})
        group by p.id, p.quantity having sum(t.quantity_delta) <> p.quantity) x`),
    q(sql`select count(*) as today from audit_logs where org_id = ${orgId} and facility_id = any(${inIds}) and created_at > now() - interval '1 day'`),
    q(sql`select
        count(*) as jobs,
        coalesce(sum(label_count), 0) as labels,
        count(*) filter (where status = 'FAILED') as failed,
        count(*) filter (where status in ('PRINTED','RENDERED')) as ok,
        (select count(*) from label_templates where org_id = ${orgId} and archived = false) as templates
      from print_jobs where org_id = ${orgId} and facility_id = any(${inIds}) and created_at > now() - make_interval(days => ${days})`),
    q(sql`select w.id, w.facility_id, w.severity, w.title, w.href, w.permission, w.created_at, f.name as facility
      from watch_findings w join facilities f on f.id = w.facility_id
      where w.org_id = ${orgId} and w.status = 'OPEN'
      order by case w.severity when 'critical' then 0 when 'warning' then 1 else 2 end, w.created_at desc`),
    q(sql`select a.id, a.entity_type, a.entity_id, a.action, a.user_name, a.created_at, a.after, f.name as facility
      from audit_logs a left join facilities f on f.id = a.facility_id
      where a.org_id = ${orgId} and a.facility_id = any(${inIds})
      order by a.created_at desc limit 6`),
    q(sql`select f.id, f.name, f.license_number,
        (select count(*) from plants p where p.facility_id = f.id and p.status = 'ACTIVE')
          + (select coalesce(sum(b.untagged_count), 0) from plant_batches b where b.facility_id = f.id and b.status = 'ACTIVE') as plants,
        (select count(*) from packages p where p.facility_id = f.id and p.status in ('ACTIVE','ALLOCATED')) as packages,
        (select coalesce(sum(s.total), 0) from sales s where s.facility_id = f.id and s.status = 'COMPLETED' and ${local(sql`s.completed_at`)} >= ${start})
          + (select coalesce(sum(i.total), 0) from invoices i where i.facility_id = f.id and ${local(sql`i.created_at`)} >= ${start}) as sales
      from facilities f where f.org_id = ${orgId} order by f.name`),
    q(sql`select
        count(*) filter (where status in ('DRAFT','CONFIRMED','PACKED','SHIPPED')) as open,
        count(*) filter (where status in ('CONFIRMED','PACKED')) as to_ship
      from orders where org_id = ${orgId} and facility_id = any(${inIds})`),
  ]);

  // Compliance: each facility's state rules, and the lowest score among them
  const scans = await Promise.all(ids.map((id) => scanFacility(orgId, id)));
  const scored = scans.filter((s) => s.pack);
  const ruleIssues = scans.flatMap((s) => s.issues);

  const salesPoints = salesDays.map((r) => ({ day: String(r.day), value: n(r.value) }));
  const salesTotal = salesPoints.reduce((s, p) => s + p.value, 0);
  const prodPoints = prodDays.map((r) => ({ day: String(r.day), value: n(r.value) }));
  const units = prodPoints.reduce((s, p) => s + p.value, 0);
  const by = Object.fromEntries(statuses.map((r) => [String(r.status), n(r.n)]));
  const pkgTotal = (by.ACTIVE ?? 0) + (by.ALLOCATED ?? 0) + (by.ON_HOLD ?? 0) + (by.QUARANTINE ?? 0);
  const pct = (v: number) => (pkgTotal ? Math.round((v / pkgTotal) * 1000) / 10 : 0);
  // Alerts this person may see: everywhere for the facility list, in scope for the cards
  const seen = findings.filter((f) => canSee(f.permission ? String(f.permission) : null));
  const scoped = seen.filter((f) => ids.includes(String(f.facility_id)));
  const open = scoped.length;
  const urgent = scoped.filter((f) => f.severity === "critical").length;
  const pending = n(sync.pending) + n(sync.manual);

  return {
    days,
    plants: { total: n(stock.plants) + n(stock.young), tagged: n(stock.plants), young: n(stock.young), drying: n(stock.drying) },
    packages: {
      total: pkgTotal,
      active: (by.ACTIVE ?? 0) + (by.ALLOCATED ?? 0),
      held: (by.ON_HOLD ?? 0) + (by.QUARANTINE ?? 0),
      availablePct: pct(by.ACTIVE ?? 0),
      parts: [
        { key: "available", label: "Available", value: by.ACTIVE ?? 0, pct: pct(by.ACTIVE ?? 0), color: "#237a3e" },
        { key: "reserved", label: "Reserved for orders", value: by.ALLOCATED ?? 0, pct: pct(by.ALLOCATED ?? 0), color: "#7cc495" },
        { key: "hold", label: "On hold", value: by.ON_HOLD ?? 0, pct: pct(by.ON_HOLD ?? 0), color: "#f5b324" },
        { key: "quarantine", label: "In quarantine", value: by.QUARANTINE ?? 0, pct: pct(by.QUARANTINE ?? 0), color: "#dc2626" },
      ],
    },
    orders: { open: n(orders.open), toShip: n(orders.to_ship) },
    sales: { points: salesPoints, total: salesTotal, change: change(salesTotal, n(salesPrev.total)), today: n(today.total), todayTickets: n(today.tickets) },
    production: { points: prodPoints, units, change: change(units, n(prodPrev.units)), inProgress: n(stock.runs) },
    reporting: { failed: n(sync.failed), pending, upToDate: !n(sync.failed) && !pending },
    alerts: {
      open,
      urgent,
      top: scoped.slice(0, 3).map((f) => ({
        id: String(f.id),
        severity: String(f.severity) as "critical" | "warning" | "info",
        title: String(f.title),
        href: f.href ? String(f.href) : "/watch",
        at: new Date(String(f.created_at)),
        facility: String(f.facility),
      })),
    },
    labels: { jobs: n(labels.jobs), labels: n(labels.labels), failed: n(labels.failed), ok: n(labels.ok), templates: n(labels.templates) },
    compliance: {
      score: scored.length ? Math.min(...scored.map((s) => s.score)) : null,
      packName: scored[0]?.pack?.name ?? null,
      highIssues: ruleIssues.filter((i) => i.severity === "high").length,
      /** The state-rule issues to fix first, for the Compliance card. */
      issues: ruleIssues
        .filter((i) => i.severity !== "info")
        .sort((a, b) => (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1))
        .slice(0, 3)
        .map((i) => ({ id: i.id, title: i.title, severity: i.severity, href: i.fix?.href ?? "/compliance/rules" })),
      ledgerOff: n(ledger.off),
      auditToday: n(audit.today),
    },
    activity: activity.map((a) => ({
      id: String(a.id),
      text: describe(String(a.entity_type), String(a.action), a.after as unknown as Record<string, unknown> | null),
      who: String(a.user_name ?? ""),
      at: new Date(String(a.created_at)),
      facility: a.facility ? String(a.facility) : "",
    })),
    facilities: perFacility.map((f) => ({
      id: String(f.id),
      name: String(f.name),
      license: String(f.license_number),
      plants: n(f.plants),
      packages: n(f.packages),
      alerts: seen.filter((w) => String(w.facility_id) === String(f.id)).length,
      sales: n(f.sales),
      inScope: ids.includes(String(f.id)),
    })),
  };
}

const WORDS: Record<string, string> = {
  RECEIVE: "received",
  CREATE: "created",
  UPDATE: "updated",
  MOVE: "moved",
  ADJUST: "adjusted",
  SPLIT: "split",
  MERGE: "merged",
  LAB_RESULT: "lab result recorded",
  STATUS: "status changed",
  IMPORT: "imported",
  DESTROY: "destroyed",
  SALE: "sold",
  SHIP: "shipped",
  COMPLETE: "completed",
  HARVEST: "harvested",
  PRINT: "printed",
};

/** "Package PKG-000123 received", "Import from Dutchie", for the Recent activity list. */
export function describe(entityType: string, action: string, after: Record<string, unknown> | null): string {
  const thing = entityType.replace(/([a-z])([A-Z])/g, "$1 $2");
  const name = after && typeof after === "object" ? (after.tag ?? after.name ?? after.number ?? null) : null;
  if (action === "IMPORT" && after && typeof after === "object" && after.source) return `${String(after.packages ?? "")} packages imported from ${String(after.source)}`.trim();
  const verb = WORDS[action] ?? action.toLowerCase().replace(/_/g, " ");
  return `${thing}${name ? ` ${String(name)}` : ""} ${verb}`;
}
