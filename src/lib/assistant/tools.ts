import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { addLabResult, ADJUST_REASONS, adjustPackage, BULK_LIMIT, movePackage, setPackageStatus, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { can, type Permission } from "@/lib/rbac";
import { ENFORCEMENT } from "@/lib/rules";
import { scanFacility } from "@/lib/rules/scan";
import type { Session } from "@/lib/session";
import { ATTACHMENT_TOOLS } from "./attachment-tools";
import { BULK_TOOLS } from "./bulk-tools";
import { previewUndo, recentChanges, undoChange } from "./changes";
import { openFindings, sweepIfStale } from "@/lib/watch";
import { JOB_TOOLS, permissionsFor, type JobStep } from "./jobs";
import { LABEL_TOOLS } from "./label-tools";
import { LOYALTY_TOOLS } from "./loyalty-tools";
import { PURCHASING_TOOLS } from "./purchasing-tools";
import { currentZone } from "@/lib/time";

/**
 * Everything the assistant can see or do. Each tool runs with the signed-in person's own
 * business, facility, and permissions, so it can never reach further than they can by clicking.
 * Read tools answer questions. Action tools only build a proposal; nothing changes until the
 * person presses Confirm, and then the same inventory functions and checks as the screens run.
 */

type Row = Record<string, unknown>;
type Input = Record<string, unknown>;

export type Proposal = {
  title: string;
  /** Plain lines the person reviews before confirming. */
  details: { label: string; value: string }[];
  /** For plans: every step, in order, shown as a numbered list on the card. */
  steps?: string[];
  /** What runs on Confirm. Signed, so it cannot be changed in the browser. */
  action: { tool: string; args: Record<string, string> };
};

type ReadTool = {
  kind: "read";
  name: string;
  label: string;
  permission: Permission | null;
  description: string;
  schema: Record<string, unknown>;
  run: (session: Session, input: Input) => Promise<unknown>;
};

type ActionTool = {
  kind: "action";
  name: string;
  label: string;
  permission: Permission;
  description: string;
  schema: Record<string, unknown>;
  propose: (session: Session, input: Input) => Promise<Proposal>;
  /** ctx.key is unique to this confirmation; use it for anything that must happen only once. */
  execute: (actor: Actor, args: Record<string, string>, ctx?: { key: string }) => Promise<string>;
  /** Permissions beyond `permission` that these particular args need, checked again on Confirm. */
  extraPermissions?: (args: Record<string, string>) => Permission[];
  /** False for tools whose effect is not itself a change Tally should offer to undo (Undo itself). */
  record?: boolean;
};

export type Tool = ReadTool | ActionTool;

const rows = async (query: SQL) => (await db.execute<Row>(query)).rows;
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const limitOf = (v: unknown, max = 50) => Math.min(Math.max(Number(v) || 20, 1), max);
const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNIT: Record<string, string> = { EACH: "ea", G: "g", KG: "kg", MG: "mg", OZ: "oz", LB: "lb", ML: "ml", L: "L" };
/** 480.0000 EACH → 480 ea */
const qty = (amount: string | number, unit: string) => `${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${UNIT[unit] ?? unit}`;

function dateRange(input: Input, defaultDays: number): { start: string; end: string } {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: currentZone() });
  const end = DATE.test(str(input.end_date)) ? str(input.end_date) : today;
  const fallback = new Date(Date.parse(`${end}T12:00:00Z`) - (defaultDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const start = DATE.test(str(input.start_date)) ? str(input.start_date) : fallback;
  if (start > end) throw new InventoryError("The start date is after the end date.");
  return { start, end };
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const text = (description: string) => ({ type: "string", description });

async function packageByTag(session: Session, tag: string) {
  const t = tag.trim();
  if (!t) throw new InventoryError("Give the package tag.");
  // Exact tag first; otherwise people often give the last few characters, so match anywhere.
  const found = await rows(sql`
    select p.id, p.tag, p.quantity::text as quantity, p.unit, p.status, i.name as item, l.name as location, l.id as location_id
    from packages p join items i on i.id = p.item_id left join locations l on l.id = p.location_id
    where p.org_id = ${session.orgId} and p.facility_id = ${session.facilityId} and p.tag ilike ${like(t)}
    order by (upper(p.tag) = upper(${t})) desc, p.created_at desc limit 6`);
  if (!found.length) throw new InventoryError(`No package at this facility has a tag matching ${t}.`);
  const exact = found.find((f) => String(f.tag).toUpperCase() === t.toUpperCase());
  if (!exact && found.length > 1) throw new InventoryError(`Several packages match ${t}: ${found.map((f) => f.tag).join(", ")}. Ask which one.`);
  return (exact ?? found[0]) as { id: string; tag: string; quantity: string; unit: string; status: string; item: string; location: string | null; location_id: string | null };
}

export const TOOLS: Tool[] = [
  {
    kind: "read",
    name: "business_overview",
    label: "Checking the overview",
    permission: null,
    description: "Headline numbers for the current facility: plants, packages, holds, harvests drying, runs in progress, open orders, today's sales, and state reporting status. Use first for broad questions.",
    schema: obj({}),
    run: async (s) => {
      const [r] = await rows(sql`select
        (select count(*) from plants where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'ACTIVE')::int as tagged_plants,
        (select coalesce(sum(untagged_count),0) from plant_batches where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'ACTIVE')::int as young_plants,
        (select count(*) from packages where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status in ('ACTIVE','ALLOCATED'))::int as packages_in_stock,
        (select count(*) from packages where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status in ('ON_HOLD','QUARANTINE'))::int as packages_on_hold,
        (select count(*) from harvests where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'DRYING')::int as harvests_drying,
        (select count(*) from production_runs where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'IN_PROGRESS')::int as runs_in_progress,
        (select count(*) from orders where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status in ('CONFIRMED','PACKED','SHIPPED'))::int as open_orders,
        (select count(*) from sales where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'COMPLETED'
           and (completed_at at time zone ${currentZone()})::date = (now() at time zone ${currentZone()})::date)::int as sales_today,
        (select coalesce(sum(total),0) from sales where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'COMPLETED'
           and (completed_at at time zone ${currentZone()})::date = (now() at time zone ${currentZone()})::date)::text as sales_today_total,
        (select count(*) from sync_events where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'FAILED')::int as state_reports_failed,
        (select count(*) from sync_events where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'MANUAL')::int as state_reports_to_enter_by_hand,
        (select count(*) from sync_events where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'PENDING')::int as state_reports_waiting`);
      return r;
    },
  },
  {
    kind: "read",
    name: "find_packages",
    label: "Searching packages",
    permission: "inventory.view",
    description: "List packages at this facility. Filter by text (matches tag, item name, strain, or lot), status, or location name. Returns tag, item, quantity, unit, status, location, lot, latest lab result, and received date.",
    schema: obj({
      search: text("Text to match in tag, item, strain, or lot number."),
      status: { type: "string", enum: ["ACTIVE", "ALLOCATED", "ON_HOLD", "QUARANTINE", "FINISHED", "DESTROYED"] },
      location: text("Part of a location name."),
      limit: { type: "integer", description: "Up to 50. Default 20." },
    }),
    run: async (s, input) => {
      const search = str(input.search);
      const status = str(input.status);
      const location = str(input.location);
      return rows(sql`
        select p.tag, i.name as item, i.strain, p.quantity::text, p.unit, p.status, l.name as location, p.lot_number,
          (select lr.status from lab_results lr where lr.package_id = p.id order by lr.created_at desc limit 1) as lab,
          to_char(p.created_at at time zone ${currentZone()}, 'YYYY-MM-DD') as received
        from packages p join items i on i.id = p.item_id left join locations l on l.id = p.location_id
        where p.org_id = ${s.orgId} and p.facility_id = ${s.facilityId}
          ${search ? sql`and (p.tag ilike ${like(search)} or i.name ilike ${like(search)} or coalesce(i.strain,'') ilike ${like(search)} or coalesce(p.lot_number,'') ilike ${like(search)})` : sql``}
          ${status ? sql`and p.status = ${status}` : sql`and p.status not in ('FINISHED','DESTROYED')`}
          ${location ? sql`and l.name ilike ${like(location)}` : sql``}
        order by p.created_at desc limit ${limitOf(input.limit)}`);
    },
  },
  {
    kind: "read",
    name: "package_details",
    label: "Opening the package",
    permission: "inventory.view",
    description: "Full detail for one package by tag: item, quantity, status, location, cost, lab results, and its last 15 inventory transactions.",
    schema: obj({ tag: text("The package tag.") }, ["tag"]),
    run: async (s, input) => {
      const pkg = await packageByTag(s, str(input.tag, 60));
      const [detail] = await rows(sql`select p.lot_number, p.cost_per_unit::text, to_char(p.created_at at time zone ${currentZone()}, 'YYYY-MM-DD') as received
        from packages p where p.id = ${pkg.id}`);
      const labs = await rows(sql`select lab_name, status, thc_percent::text, cbd_percent::text, sample_date as sampled
        from lab_results where package_id = ${pkg.id} order by created_at desc limit 5`);
      const history = await rows(sql`select to_char(t.created_at at time zone ${currentZone()}, 'YYYY-MM-DD HH24:MI') as at, t.type, t.quantity_delta::text as change,
          t.quantity_after::text as after, t.reason_code, t.note,
          coalesce(u.name, case when k.id is not null then 'API key "' || k.name || '"' end) as by
        from inventory_transactions t left join users u on u.id = t.user_id
          left join api_keys k on 'api:' || k.id = t.user_id and k.org_id = ${s.orgId}
        where t.package_id = ${pkg.id} order by t.created_at desc limit 15`);
      return { ...pkg, id: undefined, location_id: undefined, ...detail, lab_results: labs, history };
    },
  },
  {
    kind: "read",
    name: "stock_by_item",
    label: "Totaling stock by item",
    permission: "inventory.view",
    description: "Total quantity on hand per item at this facility (active and allocated packages), with package counts and quantity on hold. Good for 'how much X do we have' and low-stock questions.",
    schema: obj({ search: text("Part of an item name or strain.") }),
    run: async (s, input) => {
      const search = str(input.search);
      return rows(sql`
        select i.name as item, i.strain, p.unit,
          sum(p.quantity) filter (where p.status in ('ACTIVE','ALLOCATED'))::text as on_hand,
          sum(p.quantity) filter (where p.status in ('ON_HOLD','QUARANTINE'))::text as on_hold,
          count(*) filter (where p.status in ('ACTIVE','ALLOCATED'))::int as packages
        from packages p join items i on i.id = p.item_id
        where p.org_id = ${s.orgId} and p.facility_id = ${s.facilityId} and p.status in ('ACTIVE','ALLOCATED','ON_HOLD','QUARANTINE')
          ${search ? sql`and (i.name ilike ${like(search)} or coalesce(i.strain,'') ilike ${like(search)})` : sql``}
        group by i.name, i.strain, p.unit order by i.name limit 100`);
    },
  },
  {
    kind: "read",
    name: "retail_sales",
    label: "Adding up register sales",
    permission: "reports.view",
    description: "Completed register (retail) sales between two dates, grouped by day, item, payment method, or budtender. Dates are YYYY-MM-DD in the store's time zone; defaults to the last 7 days. Returns counts, quantities, and dollar totals.",
    schema: obj({
      start_date: text("YYYY-MM-DD"),
      end_date: text("YYYY-MM-DD"),
      group_by: { type: "string", enum: ["day", "item", "payment_method", "budtender"] },
    }),
    run: async (s, input) => {
      const { start, end } = dateRange(input, 7);
      const day = sql`(sa.completed_at at time zone ${currentZone()})::date`;
      const where = sql`sa.org_id = ${s.orgId} and sa.facility_id = ${s.facilityId} and sa.status = 'COMPLETED' and ${day} between ${start}::date and ${end}::date`;
      const totals = (await rows(sql`select count(*)::int as sales, coalesce(sum(total),0)::text as total, coalesce(sum(discount_total),0)::text as discounts,
          coalesce(sum(excise_tax + sales_tax),0)::text as taxes from sales sa where ${where}`))[0];
      const group = str(input.group_by) || "day";
      const breakdown =
        group === "item"
          ? await rows(sql`select i.name as item, sum(sl.quantity)::text as quantity, sum(sl.quantity * sl.unit_price)::text as gross
              from sale_lines sl join sales sa on sa.id = sl.sale_id join items i on i.id = sl.item_id where ${where}
              group by i.name order by sum(sl.quantity * sl.unit_price) desc limit 25`)
          : await rows(sql`select ${group === "payment_method" ? sql`sa.payment_method::text` : group === "budtender" ? sql`sa.user_name` : sql`to_char(${day}, 'YYYY-MM-DD')`} as key,
              count(*)::int as sales, sum(sa.total)::text as total from sales sa where ${where} group by 1 order by 1 limit 100`);
      return { start, end, totals, group_by: group, breakdown };
    },
  },
  {
    kind: "read",
    name: "wholesale_orders",
    label: "Looking up orders",
    permission: "sales.view",
    description: "Wholesale orders at this facility with customer, status, value, and dates. Filter by status or customer name.",
    schema: obj({
      status: { type: "string", enum: ["DRAFT", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"] },
      customer: text("Part of a customer name."),
      limit: { type: "integer" },
    }),
    run: async (s, input) => {
      const status = str(input.status);
      const customer = str(input.customer);
      return rows(sql`
        select o.number, c.name as customer, o.status, o.manifest_number,
          (select coalesce(sum(ol.quantity * ol.unit_price),0) from order_lines ol where ol.order_id = o.id)::text as value,
          to_char(o.created_at at time zone ${currentZone()}, 'YYYY-MM-DD') as created, to_char(o.shipped_at at time zone ${currentZone()}, 'YYYY-MM-DD') as shipped
        from orders o join customers c on c.id = o.customer_id
        where o.org_id = ${s.orgId} and o.facility_id = ${s.facilityId}
          ${status ? sql`and o.status = ${status}` : sql``} ${customer ? sql`and c.name ilike ${like(customer)}` : sql``}
        order by o.created_at desc limit ${limitOf(input.limit)}`);
    },
  },
  {
    kind: "read",
    name: "unpaid_invoices",
    label: "Checking who owes money",
    permission: "sales.view",
    description: "Wholesale invoices with a balance still owed, with customer, total, paid, balance, due date, and days overdue.",
    schema: obj({}),
    run: (s) =>
      rows(sql`
        select inv.number, c.name as customer, inv.total::text, coalesce(sum(p.amount),0)::text as paid,
          (inv.total - coalesce(sum(p.amount),0))::text as balance, inv.due_date as due,
          greatest(0, (now() at time zone ${currentZone()})::date - inv.due_date::date)::int as days_overdue
        from invoices inv join customers c on c.id = inv.customer_id left join payments p on p.invoice_id = inv.id
        where inv.org_id = ${s.orgId} and inv.facility_id = ${s.facilityId}
        group by inv.id, c.name having inv.total - coalesce(sum(p.amount),0) > 0
        order by inv.due_date limit 50`),
  },
  {
    kind: "read",
    name: "customers",
    label: "Looking up customers",
    permission: "sales.view",
    description: "Wholesale customers: license number, license type, license expiry, contact, and payment terms.",
    schema: obj({ search: text("Part of a name or license number.") }),
    run: (s, input) => {
      const search = str(input.search);
      return rows(sql`select name, license_number, license_type, to_char(license_expires, 'YYYY-MM-DD') as license_expires, contact_name, phone, email, payment_terms_days, active
        from customers where org_id = ${s.orgId} ${search ? sql`and (name ilike ${like(search)} or license_number ilike ${like(search)})` : sql``}
        order by name limit 50`);
    },
  },
  {
    kind: "read",
    name: "cultivation_summary",
    label: "Checking the grow",
    permission: "cultivation.view",
    description: "Plants at this facility grouped by strain, room, and phase with weeks in phase; active batches with young untagged plants; harvests still drying with weights.",
    schema: obj({}),
    run: async (s) => ({
      plants: await rows(sql`select st.name as strain, l.name as room, p.phase, count(*)::int as plants,
          (floor(extract(epoch from now() - min(p.phase_changed_at)) / 604800) + 1)::int as weeks_in_phase, st.flowering_days
        from plants p join strains st on st.id = p.strain_id left join locations l on l.id = p.location_id
        where p.org_id = ${s.orgId} and p.facility_id = ${s.facilityId} and p.status = 'ACTIVE'
        group by st.name, l.name, p.phase, st.flowering_days order by count(*) desc limit 50`),
      batches: await rows(sql`select b.name, st.name as strain, b.untagged_count as young_plants, b.source
        from plant_batches b join strains st on st.id = b.strain_id where b.org_id = ${s.orgId} and b.facility_id = ${s.facilityId} and b.status = 'ACTIVE' limit 30`),
      drying: await rows(sql`select h.name, st.name as strain, h.plant_count, h.wet_weight::text, h.dry_weight::text, to_char(h.created_at at time zone ${currentZone()}, 'YYYY-MM-DD') as harvested
        from harvests h join strains st on st.id = h.strain_id where h.org_id = ${s.orgId} and h.facility_id = ${s.facilityId} and h.status = 'DRYING' limit 30`),
    }),
  },
  {
    kind: "read",
    name: "production_runs",
    label: "Checking production",
    permission: "inventory.view",
    description: "Manufacturing production runs with output item, planned and actual output, cost per unit, and status.",
    schema: obj({ status: { type: "string", enum: ["IN_PROGRESS", "COMPLETED", "CANCELLED"] } }),
    run: (s, input) => {
      const status = str(input.status);
      return rows(sql`select r.name, i.name as output_item, r.status, r.planned_output::text, r.actual_output::text, r.cost_per_unit::text,
          to_char(r.created_at at time zone ${currentZone()}, 'YYYY-MM-DD') as started, to_char(r.completed_at at time zone ${currentZone()}, 'YYYY-MM-DD') as completed
        from production_runs r join items i on i.id = r.output_item_id
        where r.org_id = ${s.orgId} and r.facility_id = ${s.facilityId} ${status ? sql`and r.status = ${status}` : sql``}
        order by r.created_at desc limit 30`);
    },
  },
  {
    kind: "read",
    name: "state_reporting",
    label: "Checking state reporting",
    permission: "compliance.view",
    description: "State track-and-trace reporting at this facility: counts by status and the latest reports that failed or must be entered by hand, with the error.",
    schema: obj({}),
    run: async (s) => ({
      counts: await rows(sql`select status, count(*)::int as reports from sync_events where org_id = ${s.orgId} and facility_id = ${s.facilityId} group by status`),
      needs_attention: await rows(sql`select summary, status, attempts, last_error_detail as error, to_char(created_at at time zone ${currentZone()}, 'YYYY-MM-DD HH24:MI') as created
        from sync_events where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status in ('FAILED','MANUAL') order by seq desc limit 20`),
    }),
  },
  {
    kind: "read",
    name: "state_rules_check",
    label: "Checking state rules",
    permission: "compliance.view",
    description:
      "This facility's compliance check against its state's rules: a score out of 100, open issues with how to fix them, and every rule in effect with its legal citation and how Leaf2Sale enforces it. Use for 'are we compliant', 'what are the rules', purchase limits, waste, lab testing, or manifest questions.",
    schema: obj({}),
    run: async (s) => {
      const result = await scanFacility(s.orgId, s.facilityId);
      return {
        state: result.state,
        rule_pack: result.pack ? { name: result.pack.name, reviewed: result.pack.reviewed, coverage: result.pack.coverage, tracking_system: result.pack.trackingSystem } : null,
        score: result.score,
        issues: result.issues.map((i) => ({ severity: i.severity, title: i.title, detail: i.detail, fix_page: i.fix?.href })),
        rules: result.pack?.rules.map((r) => ({ title: r.title, summary: r.summary, citation: r.source.citation, checked: r.source.checked, enforcement: ENFORCEMENT[r.kind] })) ?? [],
      };
    },
  },
  {
    kind: "read",
    name: "recent_activity",
    label: "Reading the audit trail",
    permission: "audit.view",
    description: "Recent audit trail entries: who did what and when. Filter by person name, record type (Package, Sale, Order, Plant, Harvest, User, Role, Invite), or days back (max 90).",
    schema: obj({ person: text("Part of a person's name."), record_type: text("Record type, for example Package."), days: { type: "integer" }, limit: { type: "integer" } }),
    run: (s, input) => {
      const person = str(input.person);
      const type = str(input.record_type, 40);
      const days = Math.min(Math.max(Number(input.days) || 7, 1), 90);
      return rows(sql`select to_char(created_at at time zone ${currentZone()}, 'YYYY-MM-DD HH24:MI') as at, user_name as person, entity_type as record, action, reason
        from audit_logs where org_id = ${s.orgId} and (facility_id = ${s.facilityId} or facility_id is null)
          and created_at > now() - make_interval(days => ${days})
          ${person ? sql`and user_name ilike ${like(person)}` : sql``} ${type ? sql`and entity_type ilike ${type}` : sql``}
        order by created_at desc limit ${limitOf(input.limit)}`);
    },
  },

  // ---- Actions: these only propose. The person confirms on screen. ----
  {
    kind: "action",
    name: "move_package",
    label: "Preparing a move",
    permission: "inventory.write",
    description: "Propose moving a package to another location at this facility. Nothing moves until the user presses Confirm.",
    schema: obj({ tag: text("Package tag."), to_location: text("Destination location name."), note: text("Optional note.") }, ["tag", "to_location"]),
    propose: async (s, input) => {
      const pkg = await packageByTag(s, str(input.tag, 60));
      const want = str(input.to_location);
      const matches = await rows(sql`select id, name from locations where org_id = ${s.orgId} and facility_id = ${s.facilityId}
        and name ilike ${like(want)} order by (lower(name) = lower(${want})) desc, name limit 5`);
      const exact = matches.find((m) => String(m.name).toLowerCase() === want.toLowerCase());
      if (!matches.length) throw new InventoryError(`No location matches "${want}" at this facility.`);
      if (!exact && matches.length > 1) throw new InventoryError(`Several locations match "${want}": ${matches.map((m) => m.name).join(", ")}. Ask which one.`);
      const to = (exact ?? matches[0]) as { id: string; name: string };
      if (to.id === pkg.location_id) throw new InventoryError(`Package ${pkg.tag} is already in ${to.name}.`);
      return {
        title: "Move package",
        details: [
          { label: "Package", value: `${pkg.tag} · ${pkg.item}` },
          { label: "Quantity", value: qty(pkg.quantity, pkg.unit) },
          { label: "From", value: pkg.location ?? "No location" },
          { label: "To", value: to.name },
        ],
        action: { tool: "move_package", args: { packageId: pkg.id, toLocationId: to.id, note: str(input.note, 300) } },
      };
    },
    execute: async (actor, a) => {
      const pkg = await movePackage(actor, { packageId: a.packageId, toLocationId: a.toLocationId, note: a.note || null });
      return `Moved package ${pkg.tag}.`;
    },
  },
  {
    kind: "action",
    name: "change_package_status",
    label: "Preparing a status change",
    permission: "inventory.adjust",
    description: "Propose putting a package on hold, into quarantine, or back to active, with a reason for the audit trail. Nothing changes until the user presses Confirm.",
    schema: obj(
      { tag: text("Package tag."), status: { type: "string", enum: ["ACTIVE", "ON_HOLD", "QUARANTINE"] }, reason: text("Why. Required; goes in the audit trail.") },
      ["tag", "status", "reason"],
    ),
    propose: async (s, input) => {
      const pkg = await packageByTag(s, str(input.tag, 60));
      const status = str(input.status);
      const reason = str(input.reason, 300);
      if (!["ACTIVE", "ON_HOLD", "QUARANTINE"].includes(status)) throw new InventoryError("Status must be ACTIVE, ON_HOLD, or QUARANTINE.");
      if (!reason) throw new InventoryError("A reason is required. Ask the user why.");
      if (pkg.status === status) throw new InventoryError(`Package ${pkg.tag} is already ${status}.`);
      const words: Record<string, string> = { ACTIVE: "Active", ON_HOLD: "On hold", QUARANTINE: "Quarantine", ALLOCATED: "Allocated" };
      return {
        title: status === "ACTIVE" ? "Release package" : "Hold package",
        details: [
          { label: "Package", value: `${pkg.tag} · ${pkg.item}` },
          { label: "Status", value: `${words[pkg.status] ?? pkg.status} → ${words[status]}` },
          { label: "Reason", value: reason },
        ],
        action: { tool: "change_package_status", args: { packageId: pkg.id, status, reason } },
      };
    },
    execute: async (actor, a) => {
      const pkg = await setPackageStatus(actor, { packageId: a.packageId, status: a.status, reason: a.reason });
      return `Package ${pkg.tag} is now ${pkg.status.replace("_", " ").toLowerCase()}.`;
    },
  },
  {
    kind: "action",
    name: "record_lab_result",
    label: "Preparing a lab result",
    permission: "inventory.write",
    description:
      "Propose recording a lab test result (PASS, FAIL, or PENDING) for one package, several packages, or every open package in a lot. A FAIL quarantines the packages automatically. With release_on_pass, a PASS also releases packages that are on hold. Nothing changes until the user presses Confirm. The COA file itself is attached on the package's page.",
    schema: obj(
      {
        tag: text("One package's tag."),
        tags: { type: "array", items: { type: "string" }, description: "Several package tags the same test covers." },
        lot: text("A lot number: records the result for every open package in that lot."),
        status: { type: "string", enum: ["PASS", "FAIL", "PENDING"] },
        lab_name: text("Name of the testing lab."),
        sample_date: text("Date the lab took the sample, YYYY-MM-DD. Optional."),
        thc_percent: text("Total THC %, optional."),
        cbd_percent: text("CBD %, optional."),
        notes: text("Optional notes, for example the COA number."),
        release_on_pass: { type: "boolean", description: "On a PASS, also release packages that are on hold. Default false." },
      },
      ["status", "lab_name"],
    ),
    propose: async (s, input) => {
      const status = str(input.status);
      if (!["PASS", "FAIL", "PENDING"].includes(status)) throw new InventoryError("Status must be PASS, FAIL, or PENDING.");
      const labName = str(input.lab_name, 120);
      if (!labName) throw new InventoryError("Give the name of the testing lab.");
      const sampleDate = str(input.sample_date, 10);
      if (sampleDate && !DATE.test(sampleDate)) throw new InventoryError("Sample date must look like 2026-11-27.");
      for (const [k, label] of [["thc_percent", "THC %"], ["cbd_percent", "CBD %"]] as const) {
        const v = str(input[k], 12);
        if (v && !(/^\d+(\.\d+)?$/.test(v) && Number(v) <= 100)) throw new InventoryError(`${label} must be a number from 0 to 100.`);
      }

      type Pkg = { id: string; tag: string; item: string; status: string };
      const found: Pkg[] = [];
      const tagList = [str(input.tag, 60), ...(Array.isArray(input.tags) ? input.tags.map((t) => str(t, 60)) : [])].filter(Boolean);
      for (const t of tagList) found.push(await packageByTag(s, t));
      const lot = str(input.lot, 100);
      if (lot) {
        const inLot = (await rows(sql`
          select p.id, p.tag, p.status, i.name as item from packages p join items i on i.id = p.item_id
          where p.org_id = ${s.orgId} and p.facility_id = ${s.facilityId} and lower(p.lot_number) = lower(${lot})
            and p.status not in ('FINISHED', 'DESTROYED')
          order by p.tag limit ${BULK_LIMIT + 1}`)) as Pkg[];
        if (!inLot.length) throw new InventoryError(`No open package at this facility is in lot ${lot}.`);
        found.push(...inLot);
      }
      if (!found.length) throw new InventoryError("Give a package tag, several tags, or a lot number.");
      const pkgs = [...new Map(found.map((p) => [p.id, p])).values()];
      if (pkgs.length > BULK_LIMIT) throw new InventoryError(`Record one result for at most ${BULK_LIMIT} packages at a time.`);
      const closed = pkgs.find((p) => p.status === "FINISHED" || p.status === "DESTROYED");
      if (closed) throw new InventoryError(`${closed.tag} is ${closed.status.toLowerCase()}, so it can't get a lab result.`);

      const release = status === "PASS" && input.release_on_pass === true;
      const releasing = release ? pkgs.filter((p) => p.status === "ON_HOLD") : [];
      const shown = pkgs.slice(0, 8).map((p) => `${p.tag} · ${p.item}`).join("\n") + (pkgs.length > 8 ? `\n…and ${pkgs.length - 8} more` : "");
      const effect =
        status === "FAIL"
          ? "Active or on-hold packages go to quarantine, and anything already made from them is held too"
          : release
            ? releasing.length
              ? `${releasing.length} on-hold package${releasing.length === 1 ? "" : "s"} will be released to active`
              : "No packages are on hold, so none are released"
            : "Statuses stay as they are";
      return {
        title: pkgs.length === 1 ? "Record lab result" : `Record lab result for ${pkgs.length} packages`,
        details: [
          { label: pkgs.length === 1 ? "Package" : "Packages", value: shown },
          { label: "Result", value: status },
          { label: "Lab", value: labName },
          ...(sampleDate ? [{ label: "Sample date", value: sampleDate }] : []),
          ...(str(input.thc_percent) || str(input.cbd_percent)
            ? [{ label: "Potency", value: [str(input.thc_percent) && `THC ${str(input.thc_percent)}%`, str(input.cbd_percent) && `CBD ${str(input.cbd_percent)}%`].filter(Boolean).join(" · ") }]
            : []),
          ...(str(input.notes) ? [{ label: "Notes", value: str(input.notes, 300) }] : []),
          { label: "What happens", value: effect },
        ],
        action: {
          tool: "record_lab_result",
          args: {
            packageIds: pkgs.map((p) => p.id).join(","),
            status,
            labName,
            sampleDate,
            thcPercent: str(input.thc_percent, 12),
            cbdPercent: str(input.cbd_percent, 12),
            notes: str(input.notes, 300),
            release: release ? "1" : "",
          },
        },
      };
    },
    execute: async (actor, a) => {
      const ids = a.packageIds.split(",").filter(Boolean);
      if (!ids.length) throw new InventoryError("No packages to record a result for.");
      const result = await addLabResult(actor, {
        packageId: ids[0],
        alsoPackageIds: ids.slice(1),
        labName: a.labName,
        status: a.status,
        sampleDate: a.sampleDate || null,
        thcPercent: a.thcPercent || null,
        cbdPercent: a.cbdPercent || null,
        notes: a.notes || null,
      });
      let released = 0;
      if (a.release && a.status === "PASS") {
        const held = await rows(sql`select id from packages where org_id = ${actor.orgId} and facility_id = ${actor.facilityId} and status = 'ON_HOLD' and id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
        for (const h of held) {
          await setPackageStatus(actor, { packageId: String(h.id), status: "ACTIVE", reason: `Passed lab test at ${a.labName}` });
          released++;
        }
      }
      const n = result.recorded;
      const parts = [`Recorded ${a.status} from ${a.labName} for ${n} package${n === 1 ? "" : "s"}.`];
      if (result.quarantinedCount) parts.push(`${result.quarantinedCount} quarantined.`);
      if (released) parts.push(`${released} released to active.`);
      return parts.join(" ");
    },
  },
  {
    kind: "action",
    name: "adjust_package",
    label: "Preparing an adjustment",
    permission: "inventory.adjust",
    description: `Propose setting a package to a new quantity with a reason code (${ADJUST_REASONS.map((r) => r.code).join(", ")}). Nothing changes until the user presses Confirm. The change is reported to the state.`,
    schema: obj(
      {
        tag: text("Package tag."),
        new_quantity: text("The corrected total quantity, as a number."),
        reason_code: { type: "string", enum: ADJUST_REASONS.map((r) => r.code) },
        note: text("Optional detail."),
      },
      ["tag", "new_quantity", "reason_code"],
    ),
    propose: async (s, input) => {
      const pkg = await packageByTag(s, str(input.tag, 60));
      const newQty = str(input.new_quantity, 30);
      const reason = ADJUST_REASONS.find((r) => r.code === str(input.reason_code));
      if (!reason) throw new InventoryError("Choose a reason code.");
      if (!/^\d+(\.\d+)?$/.test(newQty)) throw new InventoryError("The new quantity must be a number, for example 12.5.");
      if (Number(newQty) === Number(pkg.quantity)) throw new InventoryError(`Package ${pkg.tag} already has ${qty(pkg.quantity, pkg.unit)}.`);
      return {
        title: "Adjust quantity",
        details: [
          { label: "Package", value: `${pkg.tag} · ${pkg.item}` },
          { label: "Quantity", value: `${qty(pkg.quantity, pkg.unit)} → ${qty(newQty, pkg.unit)}` },
          { label: "Reason", value: reason.label + (str(input.note) ? ` (${str(input.note, 300)})` : "") },
          { label: "State reporting", value: "This adjustment is reported to the state" },
        ],
        action: { tool: "adjust_package", args: { packageId: pkg.id, newQuantity: newQty, reasonCode: reason.code, note: str(input.note, 300) } },
      };
    },
    execute: async (actor, a) => {
      const pkg = await adjustPackage(actor, { packageId: a.packageId, newQuantity: a.newQuantity, reasonCode: a.reasonCode, note: a.note || null });
      return `Package ${pkg.tag} is now ${qty(pkg.quantity, pkg.unit)}.`;
    },
  },
  ...LABEL_TOOLS,
  ...PURCHASING_TOOLS,
  ...LOYALTY_TOOLS,
  ...BULK_TOOLS,
  ...ATTACHMENT_TOOLS,
  {
    kind: "read",
    name: "watch_findings",
    label: "Checking Tally Watch",
    permission: null,
    description:
      "What needs attention at this facility, from Tally Watch's automatic checks: failed lab tests still sellable, mismatches with the state system, failed state reports, rule problems, expiring licenses on open orders, unlabeled new packages, open harvests and runs, overdue customers. Each item may include fix: a tool and input that fixes it; call that tool with that input to prepare the plan card. Use for 'what needs attention', 'anything wrong', 'morning rundown'.",
    schema: obj({}),
    run: async (s) => {
      await sweepIfStale(s);
      return (await openFindings(s)).slice(0, 40).map((f) => ({
        severity: f.severity,
        problem: f.title,
        detail: f.detail,
        page: f.href,
        fix: f.fix ? { tool: f.fix.tool, input: f.fix.input, what: f.fix.label } : null,
        needs_details: f.ask,
      }));
    },
  },
  {
    kind: "read",
    name: "start_of_day_brief",
    label: "Putting together the morning brief",
    permission: null,
    description:
      "The whole start-of-day picture in ONE call, read-only: headline numbers; holds and quarantine broken down by latest lab result with exact counts (no list limit); packages that failed a lab and can still be sold; active packages with no passing lab; state reporting waiting, failed, and to enter by hand, with the age of the oldest waiting report; who owes money (count, total, overdue); and what Tally Watch says needs attention. Use for 'morning brief', 'start of day', 'what do I need to know today', 'what should I fix first'. Prefer this over calling many tools.",
    schema: obj({}),
    run: async (s) => {
      const scope = (alias: string) => sql`${sql.raw(alias)}.org_id = ${s.orgId} and ${sql.raw(alias)}.facility_id = ${s.facilityId}`;
      const brief: Record<string, unknown> = {};
      const overview = TOOLS.find((t) => t.name === "business_overview");
      if (overview && overview.kind === "read") brief.overview = await overview.run(s, {});
      if (can(s, "inventory.view")) {
        brief.holds_by_lab_result = await rows(sql`
          select status, lab, count(*)::int as packages from (
            select p.status, coalesce((select lr.status from lab_results lr where lr.package_id = p.id order by lr.created_at desc limit 1)::text, 'NONE') as lab
            from packages p where ${scope("p")} and p.status in ('ON_HOLD','QUARANTINE')) x
          group by status, lab order by status, lab`);
        const [labs] = await rows(sql`
          select
            count(*) filter (where lab = 'FAIL')::int as failed_lab_still_sellable,
            count(*) filter (where not passed)::int as active_without_passing_lab
          from (select (select lr.status from lab_results lr where lr.package_id = p.id order by lr.created_at desc limit 1)::text as lab,
                  exists (select 1 from lab_results lr where lr.package_id = p.id and lr.status = 'PASS') as passed
                from packages p where ${scope("p")} and p.status in ('ACTIVE','ALLOCATED')) x`);
        brief.sellable_lab_problems = labs;
        brief.failed_lab_held_packages = await rows(sql`
          select p.tag, i.name as item, p.quantity::text, p.unit, p.status, l.name as location
          from packages p join items i on i.id = p.item_id left join locations l on l.id = p.location_id
          where ${scope("p")} and p.status in ('ON_HOLD','QUARANTINE')
            and (select lr.status from lab_results lr where lr.package_id = p.id order by lr.created_at desc limit 1) = 'FAIL'
          order by p.created_at desc limit 10`);
      }
      if (can(s, "compliance.view")) {
        const [state] = await rows(sql`
          select count(*) filter (where status = 'PENDING')::int as waiting,
            count(*) filter (where status = 'FAILED')::int as failed,
            count(*) filter (where status = 'MANUAL')::int as enter_by_hand,
            count(*) filter (where status = 'SENT')::int as sent,
            floor(extract(epoch from now() - min(created_at) filter (where status = 'PENDING')) / 3600)::int as oldest_waiting_hours
          from sync_events se where ${scope("se")}`);
        brief.state_reporting = state;
      }
      if (can(s, "sales.view")) {
        const [owed] = await rows(sql`
          select count(*)::int as unpaid_invoices, coalesce(sum(bal),0)::text as total_owed,
            count(*) filter (where due_date::date < (now() at time zone ${currentZone()})::date)::int as overdue_invoices,
            coalesce(sum(bal) filter (where due_date::date < (now() at time zone ${currentZone()})::date),0)::text as overdue_owed
          from (select inv.due_date, inv.total - coalesce((select sum(pay.amount) from payments pay where pay.invoice_id = inv.id), 0) as bal
                from invoices inv where ${scope("inv")}) x where bal > 0`);
        brief.money_owed = owed;
      }
      await sweepIfStale(s);
      brief.needs_attention = (await openFindings(s)).slice(0, 10).map((f) => ({ severity: f.severity, problem: f.title, detail: f.detail, page: f.href }));
      return brief;
    },
  },
  {
    kind: "read",
    name: "recent_tally_changes",
    label: "Checking what Tally changed",
    permission: null,
    description: "The most recent changes made through Tally at this facility (newest first): what, who, when, the result, and whether each can still be undone. Use before undo_tally_change, or for 'what did you just do'.",
    schema: obj({ limit: { type: "integer", description: "Up to 30. Default 10." } }),
    run: async (s, input) =>
      (await recentChanges(s, Math.min(Number(input.limit) || 10, 30))).map((c) => ({
        id: c.id,
        what: c.title,
        result: c.result,
        by: c.userName,
        at: c.createdAt.toLocaleString("en-US", { timeZone: currentZone(), dateStyle: "medium", timeStyle: "short" }),
        status: c.status === "UNDONE" ? `undone by ${c.undoneByName}` : c.notUndoableReason ? `can't be undone: ${c.notUndoableReason}` : "can be undone",
      })),
  },
  {
    kind: "action",
    name: "undo_tally_change",
    label: "Preparing the undo",
    permission: "inventory.view",
    record: false,
    description:
      "Propose undoing a change Tally made: the whole change is reversed as one unit, each reversal recorded in the audit trail (and reported to the state where needed). Use change 'last' for the person's most recent Tally change, or an id from recent_tally_changes. Undo is refused if anything it touched was changed again since. Nothing happens until Confirm.",
    schema: obj({ change: text("'last', or a change id from recent_tally_changes.") }, ["change"]),
    propose: async (s, input) => {
      const want = str(input.change, 60) || "last";
      let id = want;
      if (want === "last") {
        const mine = (await recentChanges(s, 30)).find((c) => c.userId === s.userId && c.status === "DONE");
        if (!mine) throw new InventoryError("There's no Tally change of yours here left to undo.");
        id = mine.id;
      }
      const actor = { userId: s.userId, userName: `${s.name} (undo via assistant)`, orgId: s.orgId, facilityId: s.facilityId };
      const { change, steps } = await previewUndo(actor, id);
      if (!undoPermissions(change.tool).every((p) => can(s, p))) throw new InventoryError("Undoing this needs the same permission as making it, and this role doesn't have it.");
      return {
        title: `Undo: ${change.title}`,
        details: [
          { label: "Done by", value: `${change.userName.replace(" (via assistant)", "")}, ${change.createdAt.toLocaleString("en-US", { timeZone: currentZone(), dateStyle: "medium", timeStyle: "short" })}` },
          { label: "Was", value: change.result.slice(0, 160) },
          { label: "Reverses", value: `${steps.length} step${steps.length === 1 ? "" : "s"}, all or nothing` },
          { label: "Audit trail", value: "Kept; the undo is added on top" },
        ],
        steps,
        action: { tool: "undo_tally_change", args: { changeId: change.id, tool: change.tool } },
      };
    },
    extraPermissions: (a) => undoPermissions(a.tool),
    execute: (actor, a) => undoChange({ ...actor, userName: actor.userName.replace("(via assistant)", "(undo via assistant)") }, a.changeId),
  },
  ...JOB_TOOLS.map((t) => (t.kind === "action" ? { ...t, extraPermissions: (a: Record<string, string>) => permissionsFor(JSON.parse(a.steps ?? "[]") as JobStep[]) } : t)),
];

/** The tools this person may use. Others are never offered to the model at all. */
export function toolsFor(session: Session): Tool[] {
  return TOOLS.filter((t) => t.permission === null || can(session, t.permission));
}

/** Undoing a change needs the same permissions as making it. */
export function undoPermissions(toolName: string): Permission[] {
  const original = TOOLS.find((t) => t.name === toolName);
  if (!original || original.kind !== "action") return ["settings.manage"];
  const perms: Permission[] = [original.permission];
  if (toolName === "run_job") perms.push("inventory.adjust");
  if (toolName === "close_out_harvest") perms.push("cultivation.write");
  return perms;
}
