import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { ADJUST_REASONS, adjustPackage, movePackage, setPackageStatus, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { can, type Permission } from "@/lib/rbac";
import { ENFORCEMENT } from "@/lib/rules";
import { scanFacility } from "@/lib/rules/scan";
import type { Session } from "@/lib/session";
import { BULK_TOOLS } from "./bulk-tools";
import { LABEL_TOOLS } from "./label-tools";

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
  execute: (actor: Actor, args: Record<string, string>) => Promise<string>;
};

export type Tool = ReadTool | ActionTool;

const TZ = "America/Denver";
const rows = async (query: SQL) => (await db.execute<Row>(query)).rows;
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const limitOf = (v: unknown, max = 50) => Math.min(Math.max(Number(v) || 20, 1), max);
const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNIT: Record<string, string> = { EACH: "ea", G: "g", KG: "kg", MG: "mg", OZ: "oz", LB: "lb", ML: "ml", L: "L" };
/** 480.0000 EACH → 480 ea */
const qty = (amount: string | number, unit: string) => `${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${UNIT[unit] ?? unit}`;

function dateRange(input: Input, defaultDays: number): { start: string; end: string } {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
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
           and (completed_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::int as sales_today,
        (select coalesce(sum(total),0) from sales where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status = 'COMPLETED'
           and (completed_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::text as sales_today_total,
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
          to_char(p.created_at at time zone ${TZ}, 'YYYY-MM-DD') as received
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
      const [detail] = await rows(sql`select p.lot_number, p.cost_per_unit::text, to_char(p.created_at at time zone ${TZ}, 'YYYY-MM-DD') as received
        from packages p where p.id = ${pkg.id}`);
      const labs = await rows(sql`select lab_name, status, thc_percent::text, cbd_percent::text, to_char(sample_date, 'YYYY-MM-DD') as sampled
        from lab_results where package_id = ${pkg.id} order by created_at desc limit 5`);
      const history = await rows(sql`select to_char(t.created_at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI') as at, t.type, t.quantity_delta::text as change,
          t.quantity_after::text as after, t.reason_code, t.note, u.name as by
        from inventory_transactions t left join users u on u.id = t.user_id
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
      const day = sql`(sa.completed_at at time zone ${TZ})::date`;
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
          to_char(o.created_at at time zone ${TZ}, 'YYYY-MM-DD') as created, to_char(o.shipped_at at time zone ${TZ}, 'YYYY-MM-DD') as shipped
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
          (inv.total - coalesce(sum(p.amount),0))::text as balance, to_char(inv.due_date, 'YYYY-MM-DD') as due,
          greatest(0, (now() at time zone ${TZ})::date - inv.due_date)::int as days_overdue
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
      drying: await rows(sql`select h.name, st.name as strain, h.plant_count, h.wet_weight::text, h.dry_weight::text, to_char(h.created_at at time zone ${TZ}, 'YYYY-MM-DD') as harvested
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
          to_char(r.created_at at time zone ${TZ}, 'YYYY-MM-DD') as started, to_char(r.completed_at at time zone ${TZ}, 'YYYY-MM-DD') as completed
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
      needs_attention: await rows(sql`select summary, status, attempts, last_error_detail as error, to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI') as created
        from sync_events where org_id = ${s.orgId} and facility_id = ${s.facilityId} and status in ('FAILED','MANUAL') order by seq desc limit 20`),
    }),
  },
  {
    kind: "read",
    name: "state_rules_check",
    label: "Checking state rules",
    permission: "compliance.view",
    description:
      "This facility's compliance check against its state's rules: a score out of 100, open issues with how to fix them, and every rule in effect with its legal citation and how CannaTrace enforces it. Use for 'are we compliant', 'what are the rules', purchase limits, waste, lab testing, or manifest questions.",
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
      return rows(sql`select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI') as at, user_name as person, entity_type as record, action, reason
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
  ...BULK_TOOLS,
];

/** The tools this person may use. Others are never offered to the model at all. */
export function toolsFor(session: Session): Tool[] {
  return TOOLS.filter((t) => t.permission === null || can(session, t.permission));
}
