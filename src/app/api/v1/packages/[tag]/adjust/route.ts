import { and, eq } from "drizzle-orm";
import { packages } from "@/db/schema";
import { apiRoute, num, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { adjustPackage } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";

/** Body: { "newQuantity": "98.5", "reasonCode": "DRYING", "note": "optional" } */
export const POST = apiRoute<{ tag: string }>({ write: true }, async (request, { key, actor }, { tag }) => {
  const body = await readJson(request);
  const [pkg] = await db
    .select({ id: packages.id })
    .from(packages)
    .where(and(eq(packages.orgId, key.orgId), eq(packages.facilityId, key.facilityId), eq(packages.tag, decodeURIComponent(tag).toUpperCase())));
  if (!pkg) throw new InventoryError(`No package with tag ${decodeURIComponent(tag)} at this facility.`);
  const updated = await adjustPackage(actor, {
    packageId: pkg.id,
    newQuantity: body.newQuantity,
    reasonCode: String(body.reasonCode ?? ""),
    note: typeof body.note === "string" ? body.note : null,
  });
  return { data: { tag: updated.tag, quantity: num(updated.quantity), status: updated.status } };
});
