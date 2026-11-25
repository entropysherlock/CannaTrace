import { asc, eq } from "drizzle-orm";
import { itemCategories, items } from "@/db/schema";
import { apiRoute, num, pageParams } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = apiRoute<Record<string, never>>({}, async (request, { key }) => {
  const { limit, offset } = pageParams(new URL(request.url));
  const rows = await db
    .select({
      id: items.id,
      sku: items.sku,
      name: items.name,
      category: itemCategories.name,
      unit: items.unit,
      strain: items.strain,
      active: items.active,
      limitCategory: items.limitCategory,
      limitPerUnit: items.limitPerUnit,
    })
    .from(items)
    .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(eq(items.orgId, key.orgId))
    .orderBy(asc(items.sku), asc(items.id))
    .limit(limit + 1)
    .offset(offset);
  return { data: rows.slice(0, limit).map((r) => ({ ...r, limitPerUnit: num(r.limitPerUnit) })), nextOffset: rows.length > limit ? offset + limit : null };
});
