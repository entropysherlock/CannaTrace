import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  destinations,
  facilities,
  harvestPackages,
  harvests,
  itemCategories,
  items,
  labResults,
  locations,
  orderAllocations,
  orders,
  packages,
  plantBatches,
  plants,
  strains,
  retailSettings,
} from "@/db/schema";
import type { LabelKind, LabelRecord } from "./types";

export type Scope = { orgId: string; facilityId: string };

export class LabelDataError extends Error {}

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const UNIT: Record<string, string> = { MG: "mg", G: "g", KG: "kg", OZ: "oz", LB: "lb", ML: "ml", L: "L", EACH: "each" };
const title = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : null);
const trimNum = (s: string | null) => (s === null ? null : String(Number(s)));

async function facilityValues(scope: Scope) {
  const [f] = await db.select().from(facilities).where(and(eq(facilities.id, scope.facilityId), eq(facilities.orgId, scope.orgId)));
  if (!f) throw new LabelDataError("This facility was not found.");
  const [store] = await db.select({ warning: retailSettings.labelWarning }).from(retailSettings).where(eq(retailSettings.facilityId, f.id));
  return { "facility.name": f.name, "facility.license": f.licenseNumber, "facility.state": f.state, today: day(new Date()), "store.warning": store?.warning ?? null };
}

/** Throw if any requested id wasn't found here. Records at another facility look exactly like records that don't exist. */
function requireAll(ids: string[], found: Set<string>, what: string) {
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new LabelDataError(`${missing.length === 1 ? `That ${what} was` : `${missing.length} ${what}s were`} not found at this facility.`);
}

async function packageRecords(scope: Scope, ids: string[], fac: Record<string, string | null>): Promise<LabelRecord[]> {
  const rows = await db
    .select({ pkg: packages, item: items, category: itemCategories.name })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(and(eq(packages.orgId, scope.orgId), eq(packages.facilityId, scope.facilityId), inArray(packages.id, ids)));
  requireAll(ids, new Set(rows.map((r) => r.pkg.id)), "package");

  const labs = await db
    .select()
    .from(labResults)
    .where(and(eq(labResults.orgId, scope.orgId), eq(labResults.facilityId, scope.facilityId), inArray(labResults.packageId, ids)))
    .orderBy(desc(labResults.createdAt));
  const latestLab = new Map<string, (typeof labs)[number]>();
  for (const l of labs) if (!latestLab.has(l.packageId)) latestLab.set(l.packageId, l);

  const harvested = await db
    .select({ packageId: harvestPackages.packageId, at: harvests.harvestedAt })
    .from(harvestPackages)
    .innerJoin(harvests, eq(harvests.id, harvestPackages.harvestId))
    .where(inArray(harvestPackages.packageId, ids));
  const harvestDate = new Map(harvested.map((h) => [h.packageId, day(h.at)]));

  const byId = new Map(rows.map((r) => [r.pkg.id, r]));
  return ids.map((id) => {
    const { pkg, item, category } = byId.get(id)!;
    const lab = latestLab.get(id);
    const passed = lab?.status === "PASS";
    return {
      ref: pkg.tag,
      sourceId: pkg.id,
      values: {
        ...fac,
        "package.tag": pkg.tag,
        "package.quantity": trimNum(pkg.quantity),
        "package.unit": UNIT[pkg.unit] ?? pkg.unit,
        "package.lot": pkg.lotNumber,
        "package.status": title(pkg.status),
        "package.created": day(pkg.createdAt),
        "package.harvested": harvestDate.get(id) ?? null,
        "item.name": item.name,
        "item.sku": item.sku,
        "item.category": category,
        "item.strain": item.strain,
        "lab.status": lab ? title(lab.status) : "Not tested",
        "lab.name": lab?.labName ?? null,
        "lab.date": lab?.sampleDate ?? null,
        // Potency only ever comes from a passed test. A pending or failed result leaves these empty.
        "lab.thc": passed && lab.thcPercent !== null ? `${Number(lab.thcPercent)}%` : null,
        "lab.cbd": passed && lab.cbdPercent !== null ? `${Number(lab.cbdPercent)}%` : null,
        "_package.status": pkg.status,
        "_package.quantity": pkg.quantity,
        "_lab.status": lab?.status ?? null,
      },
    };
  });
}

async function plantRecords(scope: Scope, ids: string[], fac: Record<string, string | null>): Promise<LabelRecord[]> {
  const rows = await db
    .select({ plant: plants, strain: strains.name, batch: plantBatches.name, location: locations.name })
    .from(plants)
    .innerJoin(strains, eq(strains.id, plants.strainId))
    .innerJoin(plantBatches, eq(plantBatches.id, plants.batchId))
    .innerJoin(locations, eq(locations.id, plants.locationId))
    .where(and(eq(plants.orgId, scope.orgId), eq(plants.facilityId, scope.facilityId), inArray(plants.id, ids)));
  requireAll(ids, new Set(rows.map((r) => r.plant.id)), "plant");
  const byId = new Map(rows.map((r) => [r.plant.id, r]));
  return ids.map((id) => {
    const r = byId.get(id)!;
    return {
      ref: r.plant.tag,
      sourceId: id,
      values: {
        ...fac,
        "plant.tag": r.plant.tag,
        "plant.strain": r.strain,
        "plant.phase": title(r.plant.phase),
        "plant.batch": r.batch,
        "plant.location": r.location,
        "plant.planted": day(r.plant.createdAt),
        "_plant.status": r.plant.status,
      },
    };
  });
}

async function batchRecords(scope: Scope, ids: string[], fac: Record<string, string | null>): Promise<LabelRecord[]> {
  const rows = await db
    .select({ batch: plantBatches, strain: strains.name, location: locations.name })
    .from(plantBatches)
    .innerJoin(strains, eq(strains.id, plantBatches.strainId))
    .innerJoin(locations, eq(locations.id, plantBatches.locationId))
    .where(and(eq(plantBatches.orgId, scope.orgId), eq(plantBatches.facilityId, scope.facilityId), inArray(plantBatches.id, ids)));
  requireAll(ids, new Set(rows.map((r) => r.batch.id)), "batch");
  const byId = new Map(rows.map((r) => [r.batch.id, r]));
  return ids.map((id) => {
    const r = byId.get(id)!;
    const alive = r.batch.initialCount - r.batch.destroyedCount;
    return {
      ref: r.batch.name,
      sourceId: id,
      values: {
        ...fac,
        "batch.name": r.batch.name,
        "batch.strain": r.strain,
        "batch.source": title(r.batch.source),
        "batch.count": String(alive),
        "batch.location": r.location,
        "batch.started": day(r.batch.createdAt),
      },
    };
  });
}

/** A transfer label is printed for each package allocated to the order, in a fixed order. */
async function transferRecords(scope: Scope, orderIds: string[], fac: Record<string, string | null>): Promise<LabelRecord[]> {
  const rows = await db
    .select({ order: orders, customer: customers, destination: destinations })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(destinations, eq(destinations.id, orders.destinationId))
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.facilityId, scope.facilityId), inArray(orders.id, orderIds)));
  requireAll(orderIds, new Set(rows.map((r) => r.order.id)), "order");
  const out: LabelRecord[] = [];
  for (const id of orderIds) {
    const { order, customer, destination } = rows.find((r) => r.order.id === id)!;
    const allocs = await db.select({ packageId: orderAllocations.packageId }).from(orderAllocations).where(eq(orderAllocations.orderId, id)).orderBy(asc(orderAllocations.createdAt));
    if (allocs.length === 0) throw new LabelDataError(`Order ${order.number} has no packages picked yet. Pick packages before printing transfer labels.`);
    const pkgRecords = await packageRecords(scope, allocs.map((a) => a.packageId), fac);
    pkgRecords.forEach((r, i) =>
      out.push({
        ref: `${order.number} · ${r.ref}`,
        sourceId: r.sourceId,
        values: {
          ...r.values,
          "order.number": order.number,
          "order.manifest": order.manifestNumber,
          "order.customer": customer.name,
          // The receiving license is the destination's, where the order has one.
          "order.customerLicense": destination?.licenseNumber ?? customer.licenseNumber,
          "order.shipDate": order.departAt ? order.departAt.slice(0, 10) : day(order.shippedAt),
          "order.position": `${i + 1} of ${pkgRecords.length}`,
        },
      }),
    );
  }
  return out;
}

/** Load the data for a set of labels. Every value comes from a saved record at the signed-in facility. */
export async function loadLabelRecords(scope: Scope, kind: LabelKind, ids: string[]): Promise<LabelRecord[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) throw new LabelDataError("Choose at least one record to label.");
  if (unique.length > 1000) throw new LabelDataError("Print at most 1,000 records at a time.");
  const fac = await facilityValues(scope);
  switch (kind) {
    case "PACKAGE":
    case "PRODUCT":
      return packageRecords(scope, unique, fac);
    case "PLANT":
      return plantRecords(scope, unique, fac);
    case "BATCH":
      return batchRecords(scope, unique, fac);
    case "TRANSFER":
      return transferRecords(scope, unique, fac);
  }
}

export type Candidate = { id: string; ref: string; detail: string; status?: string };

/** Records that can be labeled at this facility, newest first, for the record picker. */
export async function labelCandidates(scope: Scope): Promise<Record<LabelKind, Candidate[]>> {
  const pkgRows = await db
    .select({ id: packages.id, tag: packages.tag, status: packages.status, qty: packages.quantity, unit: packages.unit, item: items.name })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .where(and(eq(packages.orgId, scope.orgId), eq(packages.facilityId, scope.facilityId), inArray(packages.status, ["ACTIVE", "ALLOCATED", "ON_HOLD", "QUARANTINE"])))
    .orderBy(desc(packages.createdAt))
    .limit(500);
  const pkgs = pkgRows.map((p) => ({ id: p.id, ref: p.tag, detail: `${p.item} · ${trimNum(p.qty)} ${UNIT[p.unit] ?? p.unit}`, status: p.status }));
  const plantRows = await db
    .select({ id: plants.id, tag: plants.tag, strain: strains.name, phase: plants.phase })
    .from(plants)
    .innerJoin(strains, eq(strains.id, plants.strainId))
    .where(and(eq(plants.orgId, scope.orgId), eq(plants.facilityId, scope.facilityId), eq(plants.status, "ACTIVE")))
    .orderBy(desc(plants.createdAt))
    .limit(500);
  const batchRows = await db
    .select({ id: plantBatches.id, name: plantBatches.name, strain: strains.name, n: plantBatches.untaggedCount })
    .from(plantBatches)
    .innerJoin(strains, eq(strains.id, plantBatches.strainId))
    .where(and(eq(plantBatches.orgId, scope.orgId), eq(plantBatches.facilityId, scope.facilityId), eq(plantBatches.status, "ACTIVE")))
    .orderBy(desc(plantBatches.createdAt))
    .limit(300);
  const orderRows = await db
    .select({ id: orders.id, number: orders.number, status: orders.status, customer: customers.name })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.facilityId, scope.facilityId), inArray(orders.status, ["CONFIRMED", "PACKED", "SHIPPED"])))
    .orderBy(desc(orders.createdAt))
    .limit(200);
  return {
    PACKAGE: pkgs,
    PRODUCT: pkgs,
    PLANT: plantRows.map((p) => ({ id: p.id, ref: p.tag, detail: `${p.strain} · ${title(p.phase)}` })),
    BATCH: batchRows.map((b) => ({ id: b.id, ref: b.name, detail: `${b.strain} · ${b.n} untagged` })),
    TRANSFER: orderRows.map((o) => ({ id: o.id, ref: o.number, detail: o.customer, status: o.status })),
  };
}
