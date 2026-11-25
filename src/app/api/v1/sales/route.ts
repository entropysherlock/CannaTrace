import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { sales } from "@/db/schema";
import { apiRoute, pageParams } from "@/lib/api";
import { db } from "@/lib/db";
import { parseDate } from "@/lib/distribution-math";

/** Completed and voided retail sales. ?since=YYYY-MM-DD limits to sales on or after that day (UTC). */
export const GET = apiRoute<Record<string, never>>({}, async (request, { key }) => {
  const url = new URL(request.url);
  const { limit, offset } = pageParams(url);
  const since = url.searchParams.get("since");
  const from = since ? new Date(`${parseDate(since, "since")}T00:00:00Z`) : null;
  const rows = await db
    .select({
      number: sales.number,
      status: sales.status,
      customerType: sales.customerType,
      subtotal: sales.subtotal,
      discountTotal: sales.discountTotal,
      exciseTax: sales.exciseTax,
      salesTax: sales.salesTax,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      completedAt: sales.completedAt,
    })
    .from(sales)
    .where(and(eq(sales.orgId, key.orgId), eq(sales.facilityId, key.facilityId), inArray(sales.status, ["COMPLETED", "VOIDED"]), from ? gte(sales.createdAt, from) : undefined))
    .orderBy(asc(sales.createdAt), asc(sales.id))
    .limit(limit + 1)
    .offset(offset);
  return { data: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
});
