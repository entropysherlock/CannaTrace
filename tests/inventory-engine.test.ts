import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLogs,
  facilities,
  inventoryTransactions,
  itemCategories,
  items,
  locations,
  organizations,
  packageLineage,
  packages,
  users,
} from "@/db/schema";
import { db, pool } from "@/lib/db";
import {
  InventoryError,
  addLabResult,
  adjustPackage,
  destroyPackage,
  mergePackages,
  movePackage,
  receivePackage,
  recordCycleCount,
  setPackageStatus,
  splitPackage,
  type Actor,
} from "@/lib/inventory";

// These tests need a migrated Postgres database. They create their own organization
// and never touch other data.
const hasDb = Boolean(process.env.DATABASE_URL);
const run = `T${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

let actor: Actor;
let otherFacilityActor: Actor;
let flower: string;
let jars: string;
let rackA: string;
let rackB: string;

const qtyOf = async (id: string) => {
  const [row] = await db.select().from(packages).where(eq(packages.id, id));
  return { quantity: new Decimal(row.quantity).toString(), status: row.status, locationId: row.locationId };
};
const receive = (quantity: string, extra: { itemId?: string; lotNumber?: string; costPerUnit?: string } = {}) =>
  receivePackage(actor, { tag: tag(), itemId: extra.itemId ?? flower, quantity, locationId: rackA, ...extra });

describe.skipIf(!hasDb)("inventory engine (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Test Org ${run}` }).returning();
    const [facility, other] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "Test Facility", licenseNumber: `${run}-A`, licenseType: "CULTIVATION", state: "NM" },
        { orgId: org.id, name: "Other Facility", licenseNumber: `${run}-B`, licenseType: "RETAIL", state: "NM" },
      ])
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Test User", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "INVENTORY" })
      .returning();
    const locs = await db
      .insert(locations)
      .values([
        { orgId: org.id, facilityId: facility.id, name: "Rack A", type: "RACK" },
        { orgId: org.id, facilityId: facility.id, name: "Rack B", type: "RACK" },
      ])
      .returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const made = await db
      .insert(items)
      .values([
        { orgId: org.id, name: "Bulk Flower", sku: "BULK", categoryId: category.id, unit: "G" },
        { orgId: org.id, name: "Jars", sku: "JAR", categoryId: category.id, unit: "EACH" },
      ])
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    otherFacilityActor = { ...actor, facilityId: other.id };
    [rackA, rackB] = locs.map((l) => l.id);
    [flower, jars] = made.map((i) => i.id);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("receives a package and records the transaction and audit entry", async () => {
    const pkg = await receive("100.5");
    expect(await qtyOf(pkg.id)).toMatchObject({ quantity: "100.5", status: "ACTIVE", locationId: rackA });
    const tx = await db.select().from(inventoryTransactions).where(eq(inventoryTransactions.packageId, pkg.id));
    expect(tx).toHaveLength(1);
    expect(tx[0].type).toBe("RECEIVE");
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, pkg.id));
    expect(audit.map((a) => a.action)).toEqual(["RECEIVE"]);
  });

  it("rejects a duplicate tag", async () => {
    const pkg = await receive("10");
    await expect(
      receivePackage(actor, { tag: pkg.tag.toLowerCase(), itemId: flower, quantity: "5", locationId: rackA }),
    ).rejects.toThrow(/already in use/);
  });

  it("moves and adjusts, never below zero", async () => {
    const pkg = await receive("50");
    await movePackage(actor, { packageId: pkg.id, toLocationId: rackB });
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "48.25", reasonCode: "DRYING" });
    expect(await qtyOf(pkg.id)).toMatchObject({ quantity: "48.25", locationId: rackB });
    await expect(adjustPackage(actor, { packageId: pkg.id, newQuantity: "-1", reasonCode: "DRYING" })).rejects.toThrow(InventoryError);
    await expect(adjustPackage(actor, { packageId: pkg.id, newQuantity: "40", reasonCode: "NOPE" })).rejects.toThrow(/reason/);
  });

  it("splits without creating or losing product", async () => {
    const source = await receive("100", { lotNumber: "LOT-1", costPerUnit: "2.5" });
    const { children } = await splitPackage(actor, {
      packageId: source.id,
      parts: [
        { tag: tag(), quantity: "28" },
        { tag: tag(), quantity: "28.3495" },
      ],
    });
    const after = await qtyOf(source.id);
    const total = children.reduce((sum, c) => sum.add(c.quantity), new Decimal(after.quantity));
    expect(total.toString()).toBe("100");
    expect(after.quantity).toBe("43.6505");
    expect(children.every((c) => c.lotNumber === "LOT-1" && c.itemId === flower)).toBe(true);
    const lineage = await db.select().from(packageLineage).where(eq(packageLineage.parentId, source.id));
    expect(lineage).toHaveLength(2);
  });

  it("finishes the source when a split uses all of it", async () => {
    const source = await receive("7");
    await splitPackage(actor, { packageId: source.id, parts: [{ tag: tag(), quantity: "3.5" }, { tag: tag(), quantity: "3.5" }] });
    expect(await qtyOf(source.id)).toMatchObject({ quantity: "0", status: "FINISHED" });
  });

  it("changes nothing when a split fails", async () => {
    const source = await receive("10");
    const taken = await receive("1");
    const fresh = tag();
    await expect(
      splitPackage(actor, { packageId: source.id, parts: [{ tag: fresh, quantity: "2" }, { tag: taken.tag, quantity: "2" }] }),
    ).rejects.toThrow(/already in use/);
    await expect(splitPackage(actor, { packageId: source.id, parts: [{ tag: tag(), quantity: "10.0001" }] })).rejects.toThrow(/only holds/);
    expect((await qtyOf(source.id)).quantity).toBe("10");
    expect(await db.select().from(packages).where(eq(packages.tag, fresh))).toHaveLength(0);
  });

  it("merges same-lot packages with a weighted average cost", async () => {
    const a = await receive("100", { lotNumber: "LOT-M", costPerUnit: "2" });
    const b = await receive("300", { lotNumber: "LOT-M", costPerUnit: "4" });
    const merged = await mergePackages(actor, { sourceIds: [a.id, b.id], newTag: tag() });
    expect(new Decimal(merged.quantity).toString()).toBe("400");
    expect(new Decimal(merged.costPerUnit!).toString()).toBe("3.5");
    expect(await qtyOf(a.id)).toMatchObject({ quantity: "0", status: "FINISHED" });
    expect(await qtyOf(b.id)).toMatchObject({ quantity: "0", status: "FINISHED" });
    const lineage = await db.select().from(packageLineage).where(eq(packageLineage.childId, merged.id));
    expect(lineage.map((l) => l.parentId).sort()).toEqual([a.id, b.id].sort());
  });

  it("refuses to merge different items, different lots, or a single package", async () => {
    const a = await receive("10", { lotNumber: "LOT-X" });
    const b = await receive("10", { lotNumber: "LOT-Y" });
    const c = await receive("10", { itemId: jars, lotNumber: "LOT-X" });
    await expect(mergePackages(actor, { sourceIds: [a.id, b.id], newTag: tag() })).rejects.toThrow(/different lots/);
    await expect(mergePackages(actor, { sourceIds: [a.id, c.id], newTag: tag() })).rejects.toThrow(/same item/);
    await expect(mergePackages(actor, { sourceIds: [a.id, a.id], newTag: tag() })).rejects.toThrow(/at least two/);
    expect((await qtyOf(a.id)).quantity).toBe("10");
  });

  it("blocks splitting a held package until it is released", async () => {
    const pkg = await receive("20");
    await setPackageStatus(actor, { packageId: pkg.id, status: "ON_HOLD", reason: "Waiting on paperwork" });
    await expect(splitPackage(actor, { packageId: pkg.id, parts: [{ tag: tag(), quantity: "5" }] })).rejects.toThrow(/on hold/);
    await expect(setPackageStatus(actor, { packageId: pkg.id, status: "ACTIVE", reason: " " })).rejects.toThrow(/why/);
    await setPackageStatus(actor, { packageId: pkg.id, status: "ACTIVE", reason: "Paperwork arrived" });
    await splitPackage(actor, { packageId: pkg.id, parts: [{ tag: tag(), quantity: "5" }] });
    expect((await qtyOf(pkg.id)).quantity).toBe("15");
  });

  it("destroys a package for good", async () => {
    const pkg = await receive("12");
    await destroyPackage(actor, { packageId: pkg.id, reason: "Mold, rendered unusable" });
    expect(await qtyOf(pkg.id)).toMatchObject({ quantity: "0", status: "DESTROYED" });
    await expect(adjustPackage(actor, { packageId: pkg.id, newQuantity: "5", reasonCode: "ENTRY_ERROR" })).rejects.toThrow(/destroyed/);
    await expect(setPackageStatus(actor, { packageId: pkg.id, status: "ACTIVE", reason: "oops" })).rejects.toThrow(/destroyed/);
  });

  it("applies cycle count variances only where the count differs", async () => {
    const [loc] = await db
      .insert(locations)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `Count Bin ${run}`, type: "BIN" })
      .returning();
    const a = await receivePackage(actor, { tag: tag(), itemId: flower, quantity: "100", locationId: loc.id });
    const b = await receivePackage(actor, { tag: tag(), itemId: flower, quantity: "50", locationId: loc.id });
    const result = await recordCycleCount(actor, {
      locationId: loc.id,
      counts: [
        { packageId: a.id, counted: "100" },
        { packageId: b.id, counted: "49.2" },
      ],
    });
    expect(result).toMatchObject({ packagesCounted: 2, variances: 1 });
    expect((await qtyOf(b.id)).quantity).toBe("49.2");
    const txA = await db.select().from(inventoryTransactions).where(eq(inventoryTransactions.packageId, a.id));
    expect(txA).toHaveLength(1);
  });

  it("quarantines a package when a lab result fails", async () => {
    const pkg = await receive("30");
    const pass = await addLabResult(actor, { packageId: pkg.id, labName: "Mesa Labs", status: "PASS", thcPercent: "24.5" });
    expect(pass.quarantined).toBe(false);
    const fail = await addLabResult(actor, { packageId: pkg.id, labName: "Mesa Labs", status: "FAIL" });
    expect(fail.quarantined).toBe(true);
    expect((await qtyOf(pkg.id)).status).toBe("QUARANTINE");
    await expect(addLabResult(actor, { packageId: pkg.id, labName: "Mesa Labs", status: "PASS", thcPercent: "140" })).rejects.toThrow(/between 0 and 100/);
    await expect(
      addLabResult(actor, { packageId: pkg.id, labName: "Mesa Labs", status: "PASS", coa: { name: "x.exe", type: "application/x-msdownload", data: Buffer.from("x") } }),
    ).rejects.toThrow(/PDF, PNG, or JPEG/);
  });

  it("keeps facilities separate", async () => {
    const pkg = await receive("10");
    await expect(adjustPackage(otherFacilityActor, { packageId: pkg.id, newQuantity: "1", reasonCode: "ENTRY_ERROR" })).rejects.toThrow(/not found/);
    await expect(movePackage(otherFacilityActor, { packageId: pkg.id, toLocationId: rackB })).rejects.toThrow(/not found/);
    await expect(receivePackage(otherFacilityActor, { tag: tag(), itemId: flower, quantity: "1", locationId: rackA })).rejects.toThrow(/location/);
  });

  it("keeps the ledger consistent with package quantities", async () => {
    const rows = await db.execute<{ id: string }>(sql`
      select p.id
      from packages p
      join inventory_transactions t on t.package_id = p.id
      where p.org_id = ${actor.orgId}
      group by p.id, p.quantity
      having sum(t.quantity_delta) <> p.quantity
    `);
    expect(rows.rows).toHaveLength(0);
  });

  it("does not allow history to be edited or deleted", async () => {
    await expect(db.update(auditLogs).set({ reason: "tampered" }).where(eq(auditLogs.orgId, actor.orgId))).rejects.toThrow();
    await expect(db.delete(inventoryTransactions).where(eq(inventoryTransactions.orgId, actor.orgId))).rejects.toThrow();
  });
});
