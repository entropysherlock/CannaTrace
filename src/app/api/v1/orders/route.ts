import { and, asc, eq } from "drizzle-orm";
import { customers, invoices, orders } from "@/db/schema";
import { apiRoute, pageParams } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = apiRoute<Record<string, never>>({}, async (request, { key }) => {
  const { limit, offset } = pageParams(new URL(request.url));
  const rows = await db
    .select({
      number: orders.number,
      status: orders.status,
      customer: customers.name,
      customerLicense: customers.licenseNumber,
      manifestNumber: orders.manifestNumber,
      invoiceNumber: invoices.number,
      invoiceTotal: invoices.total,
      invoiceDue: invoices.dueDate,
      createdAt: orders.createdAt,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(invoices, eq(invoices.orderId, orders.id))
    .where(and(eq(orders.orgId, key.orgId), eq(orders.facilityId, key.facilityId)))
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(limit + 1)
    .offset(offset);
  return { data: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
});
