import { and, desc, eq } from "drizzle-orm";
import { inventoryTransactions, items, locations, packages } from "@/db/schema";
import { apiRoute, num, safeDecode } from "@/lib/api";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";

export const GET = apiRoute<{ tag: string }>({}, async (_request, { key }, { tag }) => {
  const [pkg] = await db
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
    .where(and(eq(packages.orgId, key.orgId), eq(packages.facilityId, key.facilityId), eq(packages.tag, safeDecode(tag).toUpperCase())));
  if (!pkg) throw new InventoryError(`No package with tag ${safeDecode(tag)} at this facility.`);
  const history = await db
    .select({
      type: inventoryTransactions.type,
      quantityDelta: inventoryTransactions.quantityDelta,
      quantityAfter: inventoryTransactions.quantityAfter,
      reasonCode: inventoryTransactions.reasonCode,
      note: inventoryTransactions.note,
      createdAt: inventoryTransactions.createdAt,
    })
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.packageId, pkg.id))
    .orderBy(desc(inventoryTransactions.createdAt))
    .limit(100);
  return {
    data: {
      ...pkg,
      quantity: num(pkg.quantity),
      costPerUnit: num(pkg.costPerUnit),
      history: history.map((h) => ({ ...h, quantityDelta: num(h.quantityDelta), quantityAfter: num(h.quantityAfter) })),
    },
  };
});
