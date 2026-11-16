import { and, asc, eq } from "drizzle-orm";
import { items, locations, packages, type PackageStatus } from "@/db/schema";
import { apiRoute, num, pageParams } from "@/lib/api";
import { db } from "@/lib/db";

const STATUSES = ["ACTIVE", "ALLOCATED", "ON_HOLD", "QUARANTINE", "FINISHED", "DESTROYED"];

export const GET = apiRoute<Record<string, never>>({}, async (request, { key }) => {
  const url = new URL(request.url);
  const { limit, offset } = pageParams(url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const rows = await db
    .select({
      id: packages.id,
      tag: packages.tag,
      status: packages.status,
      quantity: packages.quantity,
      unit: packages.unit,
      lotNumber: packages.lotNumber,
      costPerUnit: packages.costPerUnit,
      createdAt: packages.createdAt,
      itemSku: items.sku,
      itemName: items.name,
      location: locations.name,
    })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .leftJoin(locations, eq(locations.id, packages.locationId))
    .where(
      and(
        eq(packages.orgId, key.orgId),
        eq(packages.facilityId, key.facilityId),
        status && STATUSES.includes(status) ? eq(packages.status, status as PackageStatus) : undefined,
      ),
    )
    .orderBy(asc(packages.createdAt), asc(packages.id))
    .limit(limit + 1)
    .offset(offset);
  return {
    data: rows.slice(0, limit).map((r) => ({ ...r, quantity: num(r.quantity), costPerUnit: num(r.costPerUnit) })),
    nextOffset: rows.length > limit ? offset + limit : null,
  };
});
