import { sql } from "drizzle-orm";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { can, type Permission } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

type Spec = { permission: Permission; headers: string[]; query: (org: string, fac: string) => ReturnType<typeof sql> };

const TABLES: Record<string, Spec> = {
  packages: {
    permission: "inventory.view",
    headers: ["tag", "sku", "item", "status", "quantity", "unit", "location", "lotNumber", "costPerUnit", "createdAt"],
    query: (org, fac) => sql`
      select p.tag as c1, i.sku as c2, i.name as c3, p.status as c4, p.quantity as c5, p.unit as c6, l.name as c7,
             p.lot_number as c8, p.cost_per_unit as c9, p.created_at as c10
      from packages p join items i on i.id = p.item_id left join locations l on l.id = p.location_id
      where p.org_id = ${org} and p.facility_id = ${fac} order by p.created_at`,
  },
  items: {
    permission: "inventory.view",
    headers: ["name", "sku", "category", "unit", "strain", "active"],
    query: (org) => sql`
      select i.name as c1, i.sku as c2, c.name as c3, i.unit as c4, i.strain as c5, i.active as c6
      from items i join item_categories c on c.id = i.category_id where i.org_id = ${org} order by i.sku`,
  },
  locations: {
    permission: "inventory.view",
    headers: ["name", "type"],
    query: (org, fac) => sql`select name as c1, type as c2 from locations where org_id = ${org} and facility_id = ${fac} order by name`,
  },
  customers: {
    permission: "sales.view",
    headers: ["name", "licenseNumber", "licenseType", "licenseExpires", "paymentTermsDays", "contactName", "email", "phone", "address", "licenseVerifiedAt"],
    query: (org) => sql`
      select name as c1, license_number as c2, license_type as c3, license_expires as c4, payment_terms_days as c5,
             contact_name as c6, email as c7, phone as c8, address as c9, license_verified_at as c10
      from customers where org_id = ${org} order by name`,
  },
  sales: {
    permission: "reports.view",
    headers: ["number", "status", "customerType", "subtotal", "discount", "exciseTax", "salesTax", "total", "paymentMethod", "servedBy", "completedAt"],
    query: (org, fac) => sql`
      select number as c1, status as c2, customer_type as c3, subtotal as c4, discount_total as c5, excise_tax as c6,
             sales_tax as c7, total as c8, payment_method as c9, user_name as c10, completed_at as c11
      from sales where org_id = ${org} and facility_id = ${fac} and status in ('COMPLETED','VOIDED') order by created_at`,
  },
  invoices: {
    permission: "sales.view",
    headers: ["invoice", "order", "customer", "total", "paid", "dueDate", "issuedAt"],
    query: (org, fac) => sql`
      select i.number as c1, o.number as c2, c.name as c3, i.total as c4,
             coalesce((select sum(amount) from payments p where p.invoice_id = i.id), 0) as c5, i.due_date as c6, i.created_at as c7
      from invoices i join orders o on o.id = i.order_id join customers c on c.id = i.customer_id
      where i.org_id = ${org} and i.facility_id = ${fac} order by i.created_at`,
  },
  audit: {
    permission: "audit.view",
    headers: ["when", "who", "record", "recordId", "action", "reason"],
    query: (org, fac) => sql`
      select created_at as c1, user_name as c2, entity_type as c3, entity_id as c4, action as c5, reason as c6
      from audit_logs where org_id = ${org} and (facility_id = ${fac} or facility_id is null) order by created_at`,
  },
};

export async function GET(_request: Request, { params }: { params: Promise<{ table: string }> }) {
  const session = await currentSession();
  if (!session) return new Response("Sign in to download this file.", { status: 401 });
  const { table } = await params;
  const spec = TABLES[table];
  if (!spec) return new Response("Unknown export.", { status: 404 });
  if (!can(session, spec.permission)) return new Response("Your role cannot download this.", { status: 403 });
  const result = await db.execute(spec.query(session.orgId, session.facilityId));
  // Columns are aliased c1..cN in header order, so two source columns with the same name cannot collide.
  const csv = toCsv(
    spec.headers,
    result.rows.map((row) => spec.headers.map((_, i) => (row as Record<string, unknown>)[`c${i + 1}`])),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cannatrace-${table}-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
