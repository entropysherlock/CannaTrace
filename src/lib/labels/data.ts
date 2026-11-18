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
  packageLineage,
  packages,
  plantBatches,
  plants,
  strains,
  retailSettings,
} from "@/db/schema";
import type { UnitCode } from "@/lib/units";
import { labelPackFor } from "./jurisdictions";
import { addDays, mg, mgInPackage, mgPerPackage, netQuantity, profileLine, trim } from "./quantities";
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
  return {
    "facility.name": f.name,
    "facility.license": f.licenseNumber,
    "facility.state": f.state,
    today: day(new Date()),
    "store.warning": store?.warning ?? null,
    "state.poisonCenter": labelPackFor(f.state)?.poisonCenter ?? null,
  };
}

/** Strain type by strain name, for items (which name their strain as text). */
async function strainTypes(orgId: string, names: (string | null)[]) {
  const wanted = [...new Set(names.filter((n): n is string => Boolean(n)))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ name: strains.name, type: strains.type })
    .from(strains)
    .where(and(eq(strains.orgId, orgId), inArray(strains.name, wanted)));
  return new Map(rows.map((r) => [r.name, title(r.type)!]));
}

/**
 * The harvest each package came from: directly, or through the packages it was split, merged, or made from
 * (up to a few steps back). A package made from several harvests lists each one.
 */
async function harvestsFor(ids: string[]) {
  const result = new Map<string, { names: Set<string>; dates: Set<string>; harvestIds: Set<string> }>();
  for (const id of ids) result.set(id, { names: new Set(), dates: new Set(), harvestIds: new Set() });
  // origin: package we are labelling, for every ancestor we visit
  let frontier = new Map<string, Set<string>>(ids.map((id) => [id, new Set([id])]));
  for (let step = 0; step < 6 && frontier.size > 0; step++) {
    const current = [...frontier.keys()];
    const direct = await db
      .select({ packageId: harvestPackages.packageId, harvestId: harvests.id, name: harvests.name, at: harvests.harvestedAt })
      .from(harvestPackages)
      .innerJoin(harvests, eq(harvests.id, harvestPackages.harvestId))
      .where(inArray(harvestPackages.packageId, current));
    const found = new Set<string>();
    for (const h of direct) {
      found.add(h.packageId);
      for (const origin of frontier.get(h.packageId) ?? []) {
        const r = result.get(origin)!;
        r.names.add(h.name);
        r.harvestIds.add(h.harvestId);
        const d = day(h.at);
        if (d) r.dates.add(d);
      }
    }
    const climb = current.filter((id) => !found.has(id));
    if (climb.length === 0) break;
    const parents = await db.select().from(packageLineage).where(inArray(packageLineage.childId, climb));
    const next = new Map<string, Set<string>>();
    for (const link of parents) {
      const origins = frontier.get(link.childId) ?? new Set();
      const set = next.get(link.parentId) ?? new Set<string>();
      for (const o of origins) set.add(o);
      next.set(link.parentId, set);
    }
    frontier = next;
  }
  const allHarvests = [...new Set([...result.values()].flatMap((r) => [...r.harvestIds]))];
  const batchNames = new Map<string, Set<string>>();
  if (allHarvests.length) {
    const rows = await db
      .selectDistinct({ harvestId: plants.harvestId, name: plantBatches.name })
      .from(plants)
      .innerJoin(plantBatches, eq(plantBatches.id, plants.batchId))
      .where(inArray(plants.harvestId, allHarvests));
    for (const r of rows) {
      if (!r.harvestId) continue;
      const set = batchNames.get(r.harvestId) ?? new Set<string>();
      set.add(r.name);
      batchNames.set(r.harvestId, set);
    }
  }
  const list = (s: Set<string>) => (s.size ? [...s].sort().join(", ") : null);
  return new Map(
    [...result].map(([id, r]) => [
      id,
      {
        harvest: list(r.names),
        harvested: r.dates.size ? [...r.dates].sort()[0] : null,
        plantBatch: list(new Set([...r.harvestIds].flatMap((h) => [...(batchNames.get(h) ?? [])]))),
      },
    ]),
  );
}

const pct = (v: string | null | undefined) => (v === null || v === undefined ? null : `${trim(v, 3)}%`);

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

  const origin = await harvestsFor(ids);
  const types = await strainTypes(
    scope.orgId,
    rows.map((r) => r.item.strain),
  );

  const byId = new Map(rows.map((r) => [r.pkg.id, r]));
  return ids.map((id) => {
    const { pkg, item, category } = byId.get(id)!;
    const lab = latestLab.get(id);
    const passed = lab?.status === "PASS";
    // Every potency value comes only from a passed test. A pending or failed result leaves them empty.
    const ok = (v: string | null | undefined): string | null => (passed ? (v ?? null) : null);
    // Items counted "each" are labelled one container at a time (each jar gets its own label), so their
    // net quantity and mg are for one unit. Items tracked by weight or volume are labelled as the whole package.
    const counted = pkg.unit === "EACH";
    const net = netQuantity(counted ? 1 : pkg.quantity, pkg.unit as UnitCode, item.unitWeightGrams);
    const each = item.unitWeightGrams ? netQuantity(1, "EACH", item.unitWeightGrams) : null;
    const units = "1";
    const from = origin.get(id);
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
        "package.harvested": from?.harvested ?? null,
        "package.harvest": from?.harvest ?? null,
        "package.plantBatch": from?.plantBatch ?? null,
        "package.netQuantity": net?.both ?? null,
        "package.netMetric": net?.metric ?? null,
        "package.netUs": net?.us ?? null,
        "package.expires": item.shelfLifeDays ? addDays(pkg.createdAt, item.shelfLifeDays) : null,
        "item.name": item.name,
        "item.sku": item.sku,
        "item.category": category,
        "item.strain": item.strain,
        "item.strainType": item.strain ? (types.get(item.strain) ?? null) : null,
        "item.unitWeight": each?.both ?? null,
        "item.servings": item.servingsPerUnit ? String(item.servingsPerUnit) : null,
        "item.thcPerServing": mg(item.thcMgPerServing),
        "item.cbdPerServing": mg(item.cbdMgPerServing),
        "item.thcPerPackage": mgPerPackage(item.thcMgPerServing, item.servingsPerUnit, units),
        "item.cbdPerPackage": mgPerPackage(item.cbdMgPerServing, item.servingsPerUnit, units),
        "item.directions": item.directions,
        "item.ingredients": item.ingredients,
        "item.allergens": item.allergens,
        "item.pesticides": item.pesticides,
        "item.solvents": item.solvents,
        "item.refrigerate": item.mustRefrigerate ? "Keep refrigerated." : null,
        "lab.status": lab ? title(lab.status) : "Not tested",
        "lab.name": lab?.labName ?? null,
        "lab.date": lab?.sampleDate ?? null,
        // Potency only ever comes from a passed test. A pending or failed result leaves these empty.
        "lab.thc": passed && lab.thcPercent !== null ? `${Number(lab.thcPercent)}%` : null,
        "lab.cbd": passed && lab.cbdPercent !== null ? `${Number(lab.cbdPercent)}%` : null,
        "lab.thcMg": mg(mgInPackage(ok(lab?.thcPercent), net?.grams ?? null)),
        "lab.cbdMg": mg(mgInPackage(ok(lab?.totalCbdPercent ?? lab?.cbdPercent), net?.grams ?? null)),
        "lab.thca": pct(ok(lab?.thcaPercent)),
        "lab.d9thc": pct(ok(lab?.d9ThcPercent)),
        "lab.cbda": pct(ok(lab?.cbdaPercent)),
        "lab.totalCbd": pct(ok(lab?.totalCbdPercent)),
        "lab.cbg": pct(ok(lab?.cbgPercent)),
        "lab.cbn": pct(ok(lab?.cbnPercent)),
        "lab.totalCannabinoids": pct(ok(lab?.totalCannabinoidsPercent)),
        "lab.terpenes": ok(lab?.terpenes),
        "lab.profile": passed
          ? profileLine([
              ["Total THC", lab.thcPercent],
              ["THCa", lab.thcaPercent],
              ["Δ9-THC", lab.d9ThcPercent],
              ["Total CBD", lab.totalCbdPercent],
              ["CBD", lab.cbdPercent],
              ["CBDa", lab.cbdaPercent],
              ["CBG", lab.cbgPercent],
              ["CBN", lab.cbnPercent],
              ["Total cannabinoids", lab.totalCannabinoidsPercent],
            ])
          : null,
        "_package.status": pkg.status,
        "_package.quantity": pkg.quantity,
        "_lab.status": lab?.status ?? null,
      },
    };
  });
}

async function plantRecords(scope: Scope, ids: string[], fac: Record<string, string | null>): Promise<LabelRecord[]> {
  const rows = await db
    .select({ plant: plants, strain: strains.name, strainType: strains.type, batch: plantBatches.name, location: locations.name })
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
        "plant.strainType": title(r.strainType),
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
    .select({ batch: plantBatches, strain: strains.name, strainType: strains.type, location: locations.name })
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
        "batch.strainType": title(r.strainType),
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
