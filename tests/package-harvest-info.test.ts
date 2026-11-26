import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packages, users } from "@/db/schema";
import { changePlantPhase, createPlantBatch, createStrain, harvestPlants, packageFromHarvest, recordDryWeight, tagPlants } from "@/lib/cultivation";
import { expandTags } from "@/lib/cultivation-math";
import { db, pool } from "@/lib/db";
import { cleanHarvestDate, receivePackage, setPackageHarvestInfo, splitPackage, type Actor } from "@/lib/inventory";
import { loadLabelRecords } from "@/lib/labels/data";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `HI${Date.now().toString(36).toUpperCase()}`;

describe("cleanHarvestDate", () => {
  it("allows blank, real past dates, and refuses the rest", () => {
    expect(cleanHarvestDate("", "2026-11-25")).toBeNull();
    expect(cleanHarvestDate(" 2026-10-28 ", "2026-11-25")).toBe("2026-10-28");
    expect(cleanHarvestDate("2026-11-25", "2026-11-25")).toBe("2026-11-25");
    expect(() => cleanHarvestDate("2026-02-31", "2026-11-25")).toThrow(/real date/);
    expect(() => cleanHarvestDate("10/28/2026", "2026-11-25")).toThrow(/real date/);
    expect(() => cleanHarvestDate("2026-12-01", "2026-11-25")).toThrow(/future/);
    expect(() => cleanHarvestDate("1999-01-01", "2026-11-25")).toThrow(/year/);
  });
});

describe.skipIf(!hasDb)("harvest name and date typed on a package (database)", () => {
  let actor: Actor;
  let room: string;
  let jar: string;
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Harvest Info ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Grow", licenseNumber: `${run}-A`, licenseType: "CULTIVATION", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Mgr", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [loc] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Flower 1", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const [item] = await db.insert(items).values({ orgId: org.id, name: "Alpha 3.5g", sku: `${run}-35`, categoryId: category.id, unit: "G", strain: "Alpha" }).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    room = loc.id;
    jar = item.id;
  });
  afterAll(() => pool.end());

  it("a received package with a typed harvest fills the label fields", async () => {
    const pkg = await receivePackage(actor, { tag: `${run}-IN1`, itemId: jar, quantity: "10", locationId: room, harvestName: "  Outside   Lot 7 ", harvestDate: "2026-10-28" });
    expect(pkg).toMatchObject({ harvestName: "Outside Lot 7", harvestDate: "2026-10-28" });
    const [r] = await loadLabelRecords(actor, "PACKAGE", [pkg.id]);
    expect(r.values).toMatchObject({ "package.harvest": "Outside Lot 7", "package.harvested": "2026-10-28" });
  });

  it("can be typed, changed and cleared later; bad dates are refused and nothing changes", async () => {
    const pkg = await receivePackage(actor, { tag: `${run}-IN2`, itemId: jar, quantity: "10", locationId: room });
    let [r] = await loadLabelRecords(actor, "PACKAGE", [pkg.id]);
    expect(r.values["package.harvested"]).toBeNull();
    await setPackageHarvestInfo(actor, { packageId: pkg.id, harvestName: "H-9", harvestDate: "2026-09-01" });
    [r] = await loadLabelRecords(actor, "PACKAGE", [pkg.id]);
    expect(r.values).toMatchObject({ "package.harvest": "H-9", "package.harvested": "2026-09-01" });
    await expect(setPackageHarvestInfo(actor, { packageId: pkg.id, harvestName: "X", harvestDate: "2099-01-01" })).rejects.toThrow(/future/);
    expect((await db.select().from(packages).where(eq(packages.id, pkg.id)))[0].harvestName).toBe("H-9");
    await setPackageHarvestInfo(actor, { packageId: pkg.id, harvestName: "", harvestDate: "" });
    [r] = await loadLabelRecords(actor, "PACKAGE", [pkg.id]);
    expect(r.values["package.harvested"]).toBeNull();
  });

  it("a real harvest record always wins over typed values", async () => {
    const strain = await createStrain(actor, { name: "Alpha", type: "HYBRID" });
    const batch = await createPlantBatch(actor, { name: `${run}-CLONES`, strainId: strain.id, source: "CLONE", count: "2", locationId: room });
    const tagged = await tagPlants(actor, { batchId: batch.id, tags: expandTags(`${run}-0001`, 2) });
    await changePlantPhase(actor, { plantIds: tagged.map((p) => p.id), phase: "FLOWERING" });
    const harvest = await harvestPlants(actor, { plantIds: tagged.map((p) => p.id), name: `${run}-H1`, wetWeight: "1000", unit: "G", locationId: room });
    await recordDryWeight(actor, { harvestId: harvest.id, dryWeight: "200", unit: "G" });
    const bulk = await packageFromHarvest(actor, { harvestId: harvest.id, tag: `${run}-BULK`, itemId: jar, quantity: "10", locationId: room });
    await setPackageHarvestInfo(actor, { packageId: bulk.id, harvestName: "Typed name", harvestDate: "2026-01-01" });
    const { children } = await splitPackage(actor, { packageId: bulk.id, parts: [{ tag: `${run}-JAR1`, quantity: "3.5" }] });
    for (const id of [bulk.id, children[0].id]) {
      const [r] = await loadLabelRecords(actor, "PACKAGE", [id]);
      expect(r.values["package.harvest"]).toBe(`${run}-H1`);
      expect(r.values["package.harvested"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.values["package.harvested"]).not.toBe("2026-01-01");
    }
  });
});
