import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { scanFacility } from "@/lib/rules/scan";
import { convert, type UnitCode } from "@/lib/units";
import type { Permission } from "@/lib/rbac";
import { currentZone } from "@/lib/time";
import { jobStatus } from "@/lib/job-runs";

/**
 * Tally Watch checks. Each one is a plain database query: no AI is involved in deciding what's
 * wrong, so findings are exact and repeatable. Where a fix is safe to prepare, the finding carries a
 * Tally tool and input; the person still sees the whole plan and approves it, and it can be undone.
 */

export type Severity = "critical" | "warning" | "info";
export type Finding = {
  key: string;
  check: string;
  severity: Severity;
  title: string;
  detail: string;
  permission: Permission | null;
  href?: string;
  fix?: { tool: string; input: Record<string, unknown>; label: string };
  ask?: string;
};

type Row = Record<string, unknown>;
type Scope = { orgId: string; facilityId: string };
const rows = async (q: ReturnType<typeof sql>) => (await db.execute<Row>(q)).rows;
const PER_CHECK = 100;
const UNIT: Record<string, string> = { EACH: "ea", G: "g", KG: "kg", MG: "mg", OZ: "oz", LB: "lb", ML: "ml", L: "L" };
const qty = (v: Decimal.Value, unit: string) => `${new Decimal(v).toDecimalPlaces(4).toNumber().toLocaleString("en-US", { maximumFractionDigits: 4 })} ${UNIT[unit] ?? unit}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Failed product that already left the building: shipped on a wholesale order or sold at the register.
 * Follows splits and picked parts down from the failed package, unless a part has lab results of its own.
 */
async function recalls(f: Scope): Promise<Finding[]> {
  const found = await rows(sql`
    with recursive failed as (
      select p.id from packages p
      where p.org_id = ${f.orgId} and p.facility_id = ${f.facilityId}
        and (select lr.status::text from lab_results lr where lr.package_id = p.id order by lr.created_at desc limit 1) = 'FAIL'
    ),
    tainted(id, source_id) as (
      select id, id from failed
      union
      select l.child_id, t.source_id from package_lineage l join tainted t on l.parent_id = t.id
      where not exists (select 1 from lab_results lr where lr.package_id = l.child_id)
    ),
    went as (
      select t.source_id, p.tag, 'Manifest ' || coalesce(o.manifest_number, o.number) || ' to ' || c.name as place, o.shipped_at as at
      from tainted t join order_allocations oa on oa.package_id = t.id join orders o on o.id = oa.order_id
      join customers c on c.id = o.customer_id join packages p on p.id = t.id
      where o.status in ('SHIPPED', 'DELIVERED')
      union all
      select t.source_id, p.tag, 'Sale ' || s.number, s.completed_at
      from tainted t join sale_line_packages slp on slp.package_id = t.id join sale_lines sl on sl.id = slp.sale_line_id
      join sales s on s.id = sl.sale_id join packages p on p.id = t.id
      where s.status = 'COMPLETED'
    )
    select w.source_id, src.tag as source_tag, i.name as item,
      (select lr.lab_name from lab_results lr where lr.package_id = w.source_id order by lr.created_at desc limit 1) as lab_name,
      string_agg(distinct w.place, '; ') as places, count(distinct w.place) as n
    from went w join packages src on src.id = w.source_id join items i on i.id = src.item_id
    group by w.source_id, src.tag, i.name
    order by src.tag limit ${PER_CHECK}`);
  return found.map((p) => ({
    key: `recall:${s(p.source_id)}`,
    check: "recall",
    severity: "critical",
    title: `Product from ${s(p.source_tag)} failed its lab test and has already left (${plural(Number(p.n), "shipment or sale")})`,
    detail: `${s(p.item)}, failed at ${s(p.lab_name)}. Went out on: ${s(p.places)}. Contact the customers, follow your state's recall steps, and record what comes back.`,
    permission: "inventory.view",
    href: `/inventory/${s(p.source_id)}`,
    ask: `Product from package ${s(p.source_tag)} failed its lab test after it shipped or sold. Walk me through a recall.`,
  }));
}

/** Packages whose latest lab result failed but can still be sold or used. */
async function failedLabs(f: Scope): Promise<Finding[]> {
  const found = await rows(sql`
    select p.id, p.tag, p.status, i.name as item, lr.lab_name, lr.sample_date
    from packages p join items i on i.id = p.item_id
    join lateral (select status, lab_name, sample_date from lab_results where package_id = p.id order by created_at desc limit 1) lr on true
    where p.org_id = ${f.orgId} and p.facility_id = ${f.facilityId} and p.status in ('ACTIVE','ALLOCATED') and lr.status = 'FAIL'
    order by p.tag limit ${PER_CHECK}`);
  return found.map((p) => {
    const reason = `Failed lab test (${s(p.lab_name)}${p.sample_date ? `, sampled ${s(p.sample_date)}` : ""})`;
    return {
      key: `lab_fail:${s(p.id)}`,
      check: "lab_fail",
      severity: "critical",
      title: `Package ${s(p.tag)} failed its lab test but can still be ${p.status === "ALLOCATED" ? "shipped" : "sold"}`,
      detail:
        p.status === "ALLOCATED"
          ? `${s(p.item)} is set aside for a wholesale order. Take it off the order, then hold it. ${reason}.`
          : `${s(p.item)}. ${reason}. Put it on hold until it's retested or destroyed.`,
      permission: "inventory.view",
      href: `/inventory/${s(p.id)}`,
      fix: p.status === "ACTIVE" ? { tool: "run_job", input: { title: `Hold ${s(p.tag)} (failed lab)`, steps: [{ action: "hold", tag: s(p.tag), reason }] }, label: "Hold it" } : undefined,
    };
  });
}

/** New packages from the last 3 days with no print job covering them. */
async function unlabeled(f: Scope): Promise<Finding[]> {
  const found = await rows(sql`
    select p.id, p.tag from packages p
    where p.org_id = ${f.orgId} and p.facility_id = ${f.facilityId} and p.status = 'ACTIVE'
      and p.created_at > now() - interval '3 days'
      and not exists (select 1 from print_jobs j where j.facility_id = p.facility_id and j.status not in ('FAILED','CANCELLED')
        and j.source_type in ('PACKAGE','PRODUCT') and j.source_ids ? p.id)
    order by p.created_at, p.tag limit 200`);
  if (!found.length) return [];
  const tags = found.map((p) => s(p.tag));
  return [
    {
      key: "unlabeled",
      check: "unlabeled",
      severity: "warning",
      title: `${plural(tags.length, "new package")} ${tags.length === 1 ? "has" : "have"} no label printed`,
      detail: `${tags.slice(0, 6).join(", ")}${tags.length > 6 ? ` and ${tags.length - 6} more` : ""}. Made in the last 3 days with no print job.`,
      permission: "labels.print",
      href: "/labels",
      fix: { tool: "run_job", input: { title: `Labels for ${plural(tags.length, "new package")}`, steps: [{ action: "labels", tags }] }, label: "Prepare the labels" },
    },
  ];
}

/** Open orders shipping to a license that has expired or expires within two weeks. */
async function licenses(f: Scope): Promise<Finding[]> {
  const found = await rows(sql`
    select o.id, o.number, o.status, c.name as vendor, coalesce(d.name, c.name) as place, coalesce(d.license_expires, c.license_expires) as expires,
      (coalesce(d.license_expires, c.license_expires)::date - (now() at time zone ${currentZone()})::date)::int as days
    from orders o join customers c on c.id = o.customer_id left join destinations d on d.id = o.destination_id
    where o.org_id = ${f.orgId} and o.facility_id = ${f.facilityId} and o.status in ('DRAFT','CONFIRMED','PACKED')
      and coalesce(d.license_expires, c.license_expires)::date <= (now() at time zone ${currentZone()})::date + 14
    order by expires limit ${PER_CHECK}`);
  return found.map((o) => {
    const days = Number(o.days);
    return {
      key: `license:${s(o.id)}`,
      check: "license",
      severity: days < 0 ? "critical" : "warning",
      title: `Order ${s(o.number)} ships to a license that ${days < 0 ? `expired ${s(o.expires)}` : days === 0 ? "expires today" : `expires in ${plural(days, "day")}`}`,
      detail: `${s(o.place)} (${s(o.vendor)}). ${days < 0 ? "It can't ship until the license is renewed and the new expiry is entered." : "Check the renewal before it ships."}`,
      permission: "sales.view",
      href: `/distribution/orders/${s(o.id)}`,
    };
  });
}

/** Harvests that have been drying a long time, or were weighed and still have product unaccounted for. */
async function harvests(f: Scope): Promise<Finding[]> {
  const found = await rows(sql`
    select id, name, dry_weight is not null as weighed,
      (coalesce(dry_weight, wet_weight) - waste_weight - packaged_weight)::text as left,
      (extract(epoch from now() - created_at) / 86400)::int as days
    from harvests where org_id = ${f.orgId} and facility_id = ${f.facilityId} and status = 'DRYING'
      and ((dry_weight is not null and created_at < now() - interval '3 days') or created_at < now() - interval '21 days')
    order by created_at limit ${PER_CHECK}`);
  return found.map((h) => ({
    key: `harvest:${s(h.id)}`,
    check: "harvest_open",
    severity: "warning",
    title: `Harvest ${s(h.name)} has been open ${plural(Number(h.days), "day")}`,
    detail: h.weighed
      ? `It's been weighed, and ${qty(s(h.left), "G")} still isn't packaged or logged as waste.`
      : "It still has no dry weight. Weigh it, package it, and log the waste to close it out.",
    permission: "cultivation.view",
    href: "/cultivation",
    ask: `Close out harvest ${s(h.name)}`,
  }));
}

/** Production runs left open for days, which keeps their inputs in limbo. */
async function runs(f: Scope): Promise<Finding[]> {
  const found = await rows(sql`
    select r.id, r.name, i.name as item, (extract(epoch from now() - r.created_at) / 86400)::int as days
    from production_runs r join items i on i.id = r.output_item_id
    where r.org_id = ${f.orgId} and r.facility_id = ${f.facilityId} and r.status = 'IN_PROGRESS' and r.created_at < now() - interval '3 days'
    order by r.created_at limit ${PER_CHECK}`);
  return found.map((r) => ({
    key: `run:${s(r.id)}`,
    check: "run_open",
    severity: "info",
    title: `Production run ${s(r.name)} has been open ${plural(Number(r.days), "day")}`,
    detail: `Makes ${s(r.item)}. Complete it so the output is in stock, or cancel it to return its inputs.`,
    permission: "inventory.view",
    href: `/manufacturing/runs/${s(r.id)}`,
  }));
}

/** Customers more than 30 days overdue who have orders about to ship. */
async function overdue(f: Scope): Promise<Finding[]> {
  const found = await rows(sql`
    with owed as (
      select inv.customer_id, sum(inv.total - coalesce((select sum(amount) from payments p where p.invoice_id = inv.id), 0)) as balance,
        max((now() at time zone ${currentZone()})::date - inv.due_date::date) as days
      from invoices inv where inv.org_id = ${f.orgId} and inv.facility_id = ${f.facilityId}
        and inv.total > coalesce((select sum(amount) from payments p where p.invoice_id = inv.id), 0)
        and inv.due_date::date < (now() at time zone ${currentZone()})::date - 30
      group by inv.customer_id)
    select c.id, c.name, owed.balance::text as balance, owed.days::int as days,
      (select count(*) from orders o where o.customer_id = c.id and o.facility_id = ${f.facilityId} and o.status in ('CONFIRMED','PACKED'))::int as open_orders
    from owed join customers c on c.id = owed.customer_id
    where exists (select 1 from orders o where o.customer_id = c.id and o.facility_id = ${f.facilityId} and o.status in ('CONFIRMED','PACKED'))
    order by owed.balance desc limit ${PER_CHECK}`);
  return found.map((c) => ({
    key: `overdue:${s(c.id)}`,
    check: "overdue",
    severity: "warning",
    title: `${s(c.name)} owes $${new Decimal(s(c.balance)).toFixed(2)}, up to ${plural(Number(c.days), "day")} overdue, with ${plural(Number(c.open_orders), "order")} about to ship`,
    detail: "Collect, or hold the orders, before more product goes out on credit.",
    permission: "sales.view",
    href: `/distribution/customers/${s(c.id)}`,
  }));
}

/** State reports that failed or must be typed in by hand. */
async function stateReporting(f: Scope): Promise<Finding[]> {
  const [r] = await rows(sql`select count(*) filter (where status = 'FAILED')::int as failed, count(*) filter (where status = 'MANUAL')::int as manual,
    count(*) filter (where status = 'PENDING')::int as pending
    from sync_events where org_id = ${f.orgId} and facility_id = ${f.facilityId}`);
  const out: Finding[] = [];
  // The automatic daily send is overdue or its last run failed, and this facility has records waiting on it.
  if (Number(r?.pending) > 0) {
    const job = await jobStatus("sync");
    if (job.failing || job.late)
      out.push({
        key: "sync_late",
        check: "sync_late",
        severity: "critical",
        title: job.failing
          ? `The last automatic state send didn't finish (${plural(Number(r.pending), "record")} waiting)`
          : `Automatic state sending hasn't run on time (${plural(Number(r.pending), "record")} waiting)`,
        detail: "Records only reach the state when they're sent. Press Send now on State reporting, and let CannaTrace support know so the schedule gets fixed.",
        permission: "compliance.view",
        href: "/compliance",
      });
  }
  if (Number(r?.failed) > 0)
    out.push({
      key: "sync_failed",
      check: "sync_failed",
      severity: "critical",
      title: `${plural(Number(r.failed), "state report")} failed to send`,
      detail: "Reports behind a failed one wait in line, so the state's records fall further behind until it's fixed.",
      permission: "compliance.view",
      href: "/compliance",
    });
  if (Number(r?.manual) > 0)
    out.push({
      key: "sync_manual",
      check: "sync_manual",
      severity: "warning",
      title: `${plural(Number(r.manual), "state report")} must be entered in the state system by hand`,
      detail: "Enter each one, then mark it handled on the State reporting page.",
      permission: "compliance.view",
      href: "/compliance",
    });
  return out;
}

/** High-severity problems from the state rule pack. */
async function rules(f: Scope): Promise<Finding[]> {
  const scan = await scanFacility(f.orgId, f.facilityId);
  return scan.issues
    .filter((i) => i.severity === "high")
    .map((i) => ({ key: `rule:${i.id}`, check: "rule", severity: "critical" as const, title: i.title, detail: i.detail, permission: "compliance.view" as const, href: i.fix?.href ?? "/compliance/rules" }));
}

// ---------- Matching CannaTrace against the state system ----------

const STATE_UNITS: Record<string, UnitCode> = {
  each: "EACH", ea: "EACH", count: "EACH", units: "EACH", unit: "EACH",
  grams: "G", gram: "G", g: "G", kilograms: "KG", kilogram: "KG", kg: "KG", milligrams: "MG", milligram: "MG", mg: "MG",
  ounces: "OZ", ounce: "OZ", oz: "OZ", pounds: "LB", pound: "LB", lb: "LB", lbs: "LB",
  milliliters: "ML", milliliter: "ML", ml: "ML", liters: "L", liter: "L", l: "L",
};
export const stateUnit = (raw: string | null): UnitCode | null => (raw ? (STATE_UNITS[raw.trim().toLowerCase()] ?? null) : null);
const INACTIVE = /finish|inactive|destroy|discontinu|archiv|deliver|transferred/i;

async function reconcile(f: Scope): Promise<Finding[]> {
  const [report] = await rows(sql`select id, file_name, rows, created_at, (extract(epoch from now() - created_at) / 86400)::int as days
    from state_reports where facility_id = ${f.facilityId} and org_id = ${f.orgId} order by created_at desc limit 1`);
  if (!report) return [];
  const uploaded = new Date(String(report.created_at)).toLocaleDateString("en-US", { timeZone: currentZone(), dateStyle: "medium" });
  const out: Finding[] = [];
  if (Number(report.days) > 7) {
    out.push({
      key: "state_report_old",
      check: "state_report_old",
      severity: "info",
      title: `The state package report is ${plural(Number(report.days), "day")} old`,
      detail: `Matching against the state system uses the report uploaded ${uploaded}. Export a fresh one and upload it in Tally Watch on the Dashboard.`,
      permission: "compliance.view",
      href: "/dashboard#tally-watch",
    });
    return out;
  }
  const state = new Map<string, { quantity: string | null; unit: string | null; status: string | null }>();
  for (const r of report.rows as { tag: string; quantity: string | null; unit: string | null; status: string | null }[]) state.set(r.tag.toUpperCase(), r);
  const ours = await rows(sql`select p.id, p.tag, p.quantity::text as quantity, p.unit, p.status, i.name as item from packages p join items i on i.id = p.item_id
    where p.org_id = ${f.orgId} and p.facility_id = ${f.facilityId}`);
  const source = `the state report uploaded ${uploaded}`;
  const seen = new Set<string>();
  let mismatches = 0;
  let missingThere = 0;
  let missingHere = 0;
  for (const p of ours) {
    const tag = s(p.tag).toUpperCase();
    seen.add(tag);
    const active = ["ACTIVE", "ALLOCATED", "ON_HOLD", "QUARANTINE"].includes(s(p.status));
    const theirs = state.get(tag);
    const theirsActive = theirs && !INACTIVE.test(theirs.status ?? "");
    if (active && !theirsActive) {
      if (missingThere++ < PER_CHECK)
        out.push({
          key: `state_missing:${s(p.id)}`,
          check: "state_missing",
          severity: "critical",
          title: `Package ${s(p.tag)} is in stock here but ${theirs ? `marked ${s(theirs.status).toLowerCase()}` : "missing"} in the state system`,
          detail: `${s(p.item)}, ${qty(s(p.quantity), s(p.unit))}, per ${source}. Check State reporting for a report that never went through.`,
          permission: "compliance.view",
          href: `/inventory/${s(p.id)}`,
        });
      continue;
    }
    if (!active && theirsActive && ["FINISHED", "DESTROYED"].includes(s(p.status))) {
      if (missingHere++ < PER_CHECK)
        out.push({
          key: `state_open:${s(p.id)}`,
          check: "state_open",
          severity: "critical",
          title: `Package ${s(p.tag)} is ${s(p.status).toLowerCase()} here but still open in the state system`,
          detail: `${s(p.item)}. The state shows ${theirs!.quantity ?? "?"} ${theirs!.unit ?? ""} per ${source}. Finish or destroy it there too.`,
          permission: "compliance.view",
          href: `/inventory/${s(p.id)}`,
        });
      continue;
    }
    const unreadable = (theirs as { unreadableQuantity?: string | null } | undefined)?.unreadableQuantity;
    if (active && theirsActive && theirs!.quantity === null && unreadable) {
      if (mismatches++ < PER_CHECK)
        out.push({
          key: `state_qty_unreadable:${s(p.id)}`,
          check: "state_qty",
          severity: "warning",
          title: `Couldn't read the state's quantity for ${s(p.tag)}`,
          detail: `The ${source} shows "${unreadable}" as its quantity, so it couldn't be compared with the ${new Decimal(s(p.quantity)).toString()} ${s(p.unit).toLowerCase()} here. Check the export and upload it again.`,
          permission: "compliance.view",
          href: `/inventory/${s(p.id)}`,
        });
      continue;
    }
    if (!active || !theirsActive || theirs!.quantity === null) continue;
    let stateQty: Decimal;
    try {
      stateQty = new Decimal(theirs!.quantity);
      const u = stateUnit(theirs!.unit);
      if (u && u !== p.unit) stateQty = convert(stateQty, u, s(p.unit) as UnitCode);
    } catch {
      continue; // a unit we can't compare, such as weight against a count
    }
    stateQty = stateQty.toDecimalPlaces(4);
    if (stateQty.sub(s(p.quantity)).abs().lte("0.0001")) continue;
    if (mismatches++ >= PER_CHECK) continue;
    out.push({
      key: `state_qty:${s(p.id)}:${stateQty.toString()}`,
      check: "state_qty",
      severity: "critical",
      title: `Package ${s(p.tag)}: CannaTrace has ${qty(s(p.quantity), s(p.unit))}, the state has ${qty(stateQty, s(p.unit))}`,
      detail: `${s(p.item)}, per ${source}. Recount it first. If the state is right, Tally can set CannaTrace to match.`,
      permission: "compliance.view",
      href: `/inventory/${s(p.id)}`,
      fix: {
        tool: "run_job",
        input: { title: `Match ${s(p.tag)} to the state`, steps: [{ action: "adjust", tag: s(p.tag), new_quantity: stateQty.toString(), reason_code: "COUNT_CORRECTION", reason: `Matched to ${source}` }] },
        label: `Set to ${qty(stateQty, s(p.unit))}`,
      },
    });
  }
  for (const [tag, r] of state) {
    if (seen.has(tag) || INACTIVE.test(r.status ?? "")) continue;
    if (missingHere++ >= PER_CHECK) break;
    out.push({
      key: `state_only:${tag}`,
      check: "state_only",
      severity: "critical",
      title: `Package ${tag} is open in the state system but not in CannaTrace`,
      detail: `The state shows ${r.quantity ?? "?"} ${r.unit ?? ""} per ${source}. Receive it here, or close it in the state system.`,
      permission: "compliance.view",
      href: "/inventory/receive",
      ask: `Package ${tag} is in the state system but not in CannaTrace. Help me receive it.`,
    });
  }
  if (mismatches > PER_CHECK || missingThere > PER_CHECK || missingHere > PER_CHECK)
    out.push({
      key: "state_many",
      check: "state_many",
      severity: "warning",
      title: "More differences with the state system than shown",
      detail: `Tally Watch lists the first ${PER_CHECK} of each kind. Fix these, then upload a fresh report.`,
      permission: "compliance.view",
      href: "/dashboard#tally-watch",
    });
  return out;
}

/** Each check and the kinds of finding it owns, so a check that errors never has its findings marked resolved. */
export const CHECKS: { name: string; kinds: string[]; run: (f: Scope) => Promise<Finding[]> }[] = [
  { name: "failed lab tests", kinds: ["lab_fail"], run: failedLabs },
  { name: "failed product that left", kinds: ["recall"], run: recalls },
  { name: "state system match", kinds: ["state_report_old", "state_missing", "state_open", "state_qty", "state_only", "state_many"], run: reconcile },
  { name: "state reporting", kinds: ["sync_failed", "sync_manual", "sync_late"], run: stateReporting },
  { name: "state rules", kinds: ["rule"], run: rules },
  { name: "licenses on open orders", kinds: ["license"], run: licenses },
  { name: "labels", kinds: ["unlabeled"], run: unlabeled },
  { name: "harvests", kinds: ["harvest_open"], run: harvests },
  { name: "production runs", kinds: ["run_open"], run: runs },
  { name: "overdue customers", kinds: ["overdue"], run: overdue },
];
