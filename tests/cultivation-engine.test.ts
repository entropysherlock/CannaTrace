import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  facilities,
  harvests,
  itemCategories,
  items,
  locations,
  organizations,
  packages,
  plantBatches,
  plants,
  users,
  wasteLogs,
} from "@/db/schema";
import {
  changePlantPhase,
  createPlantBatch,
  createStrain,
  destroyBatchPlants,
  destroyPlants,
  findStrainByName,
  finishHarvest,
  harvestPlants,
  logHarvestWaste,
  movePlants,
  packageFromHarvest,
  recordDryWeight,
  tagPlants,
} from "@/lib/cultivation";
import { expandTags } from "@/lib/cultivation-math";
import { db, pool } from "@/lib/db";
import type { Actor } from "@/lib/inventory";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `C${Date.now().toString(36).toUpperCase()}`;
let series = 0;
const nextTags = (count: number) => expandTags(`${run}-${++series}-0001`, count);

let actor: Actor;
let other: Actor;
let strainA: string;
let strainB: string;
let veg: string;
let flowerRoom: string;
let dryRoom: string;
let bulk: string;
let jars: string;

async function growPlants(count: number, strainId = strainA) {
  const batch = await createPlantBatch(actor, { name: `${run}-B${++series}`, strainId, source: "CLONE", count, locationId: veg });
  const tagged = await tagPlants(actor, { batchId: batch.id, tags: nextTags(count) });
  return { batchId: batch.id, ids: tagged.map((p) => p.id) };
}

describe.skipIf(!hasDb)("cultivation engine (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Cult Org ${run}` }).returning();
    const [facility, second] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "Grow", licenseNumber: `${run}-A`, licenseType: "CULTIVATION", state: "NM" },
        { orgId: org.id, name: "Other", licenseNumber: `${run}-B`, licenseType: "CULTIVATION", state: "NM" },
      ])
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Grower", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "CULTIVATION" })
      .returning();
    const locs = await db
      .insert(locations)
      .values(["Veg", "Flower", "Dry"].map((name) => ({ orgId: org.id, facilityId: facility.id, name, type: "ROOM" as const })))
      .returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const made = await db
      .insert(items)
      .values([
        { orgId: org.id, name: "Bulk", sku: "BULK", categoryId: category.id, unit: "KG" },
        { orgId: org.id, name: "Jar", sku: "JAR", categoryId: category.id, unit: "EACH" },
      ])
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    other = { ...actor, facilityId: second.id };
    [veg, flowerRoom, dryRoom] = locs.map((l) => l.id);
    [bulk, jars] = made.map((i) => i.id);
    strainA = (await createStrain(actor, { name: "Alpha", type: "HYBRID", floweringDays: "63" })).id;
    strainB = (await createStrain(actor, { name: "Beta", type: "INDICA" })).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects a duplicate strain name", async () => {
    await expect(createStrain(actor, { name: "Alpha", type: "SATIVA" })).rejects.toThrow(/already a strain/);
  });

  it("treats a name that differs only in case or spacing as the same strain", async () => {
    await expect(createStrain(actor, { name: "  alPHA ", type: "SATIVA" })).rejects.toThrow("There is already a strain called Alpha.");
    expect(await findStrainByName(actor.orgId, " ALPHA  ")).toMatchObject({ id: strainA, name: "Alpha", active: true });
    expect(await findStrainByName(actor.orgId, "Gamma")).toBeNull();
    expect(await findStrainByName("no-such-business", "Alpha")).toBeNull();
  });

  it("tags plants out of a batch and closes it when none are left", async () => {
    const batch = await createPlantBatch(actor, { name: `${run}-TAG`, strainId: strainA, source: "CLONE", count: "5", locationId: veg });
    await tagPlants(actor, { batchId: batch.id, tags: nextTags(3) });
    await expect(tagPlants(actor, { batchId: batch.id, tags: nextTags(3) })).rejects.toThrow(/2 untagged plants left/);
    await destroyBatchPlants(actor, { batchId: batch.id, count: "1", reason: "Failed to root", wasteGrams: "12" });
    await tagPlants(actor, { batchId: batch.id, tags: nextTags(1) });
    const [row] = await db.select().from(plantBatches).where(eq(plantBatches.id, batch.id));
    expect(row).toMatchObject({ untaggedCount: 0, destroyedCount: 1, status: "CLOSED" });
    expect(await db.$count(plants, eq(plants.batchId, batch.id))).toBe(4);
  });

  it("tags nothing when one tag is already used", async () => {
    const first = await growPlants(1);
    const [existing] = await db.select().from(plants).where(eq(plants.id, first.ids[0]));
    const batch = await createPlantBatch(actor, { name: `${run}-DUP`, strainId: strainA, source: "SEED", count: "3", locationId: veg });
    await expect(tagPlants(actor, { batchId: batch.id, tags: [...nextTags(2), existing.tag] })).rejects.toThrow(/already in use/);
    const [row] = await db.select().from(plantBatches).where(eq(plantBatches.id, batch.id));
    expect(row.untaggedCount).toBe(3);
    expect(await db.$count(plants, eq(plants.batchId, batch.id))).toBe(0);
  });

  it("only harvests flowering plants of one strain", async () => {
    const a = await growPlants(2);
    const b = await growPlants(1, strainB);
    await expect(
      harvestPlants(actor, { plantIds: a.ids, name: `${run}-H0`, wetWeight: "1000", unit: "G", locationId: dryRoom }),
    ).rejects.toThrow(/still vegetative/);
    await changePlantPhase(actor, { plantIds: [...a.ids, ...b.ids], phase: "FLOWERING" });
    await expect(
      harvestPlants(actor, { plantIds: [...a.ids, ...b.ids], name: `${run}-H0`, wetWeight: "1000", unit: "G", locationId: dryRoom }),
    ).rejects.toThrow(/one strain/);
    expect(await db.$count(harvests, eq(harvests.name, `${run}-H0`))).toBe(0);
  });

  it("runs a full harvest and accounts for every gram", async () => {
    const { ids } = await growPlants(4);
    expect(await movePlants(actor, { plantIds: ids, locationId: flowerRoom })).toBe(4);
    expect(await changePlantPhase(actor, { plantIds: ids, phase: "FLOWERING" })).toBe(4);
    expect(await destroyPlants(actor, { plantIds: [ids[3]], reason: "Hermaphrodite", wasteGrams: "0.4", wasteUnit: "KG" })).toBe(1);
    await expect(changePlantPhase(actor, { plantIds: [ids[3]], phase: "VEGETATIVE" })).rejects.toThrow(/already destroyed/);

    const harvest = await harvestPlants(actor, {
      plantIds: ids.slice(0, 3),
      name: `${run}-H1`,
      wetWeight: "4",
      unit: "KG",
      locationId: dryRoom,
    });
    expect(harvest.plantCount).toBe(3);
    expect(new Decimal(harvest.wetWeight).toString()).toBe("4000");
    await expect(
      harvestPlants(actor, { plantIds: ids.slice(0, 3), name: `${run}-H1B`, wetWeight: "1", unit: "KG", locationId: dryRoom }),
    ).rejects.toThrow(/already harvested/);

    await logHarvestWaste(actor, { harvestId: harvest.id, weight: "150", unit: "G", reason: "Stems" });
    await expect(recordDryWeight(actor, { harvestId: harvest.id, dryWeight: "5", unit: "KG" })).rejects.toThrow(/more than the wet weight/);
    await expect(recordDryWeight(actor, { harvestId: harvest.id, dryWeight: "100", unit: "G" })).rejects.toThrow(/already been packaged or logged/);
    await recordDryWeight(actor, { harvestId: harvest.id, dryWeight: "1000", unit: "G" });

    await expect(
      packageFromHarvest(actor, { harvestId: harvest.id, tag: `${run}-P0`, itemId: jars, quantity: "10", locationId: dryRoom }),
    ).rejects.toThrow(/tracked by weight/);
    await expect(
      packageFromHarvest(actor, { harvestId: harvest.id, tag: `${run}-P0`, itemId: bulk, quantity: "0.9", locationId: dryRoom }),
    ).rejects.toThrow(/only 850 g/);
    const pkg = await packageFromHarvest(actor, { harvestId: harvest.id, tag: `${run}-P1`, itemId: bulk, quantity: "0.8", locationId: dryRoom });
    expect(pkg.lotNumber).toBe(`${run}-H1`);
    expect(new Decimal(pkg.quantity).toString()).toBe("0.8");

    await expect(finishHarvest(actor, { harvestId: harvest.id })).rejects.toThrow(/50 g of dried product/);
    await logHarvestWaste(actor, { harvestId: harvest.id, weight: "50", unit: "G", reason: "Trim" });
    const finished = await finishHarvest(actor, { harvestId: harvest.id });
    // wet 4000 = packaged 800 + waste 200 + moisture 3000
    expect(new Decimal(finished.packagedWeight).toString()).toBe("800");
    expect(new Decimal(finished.wasteWeight).toString()).toBe("200");
    expect(new Decimal(finished.moistureLoss!).toString()).toBe("3000");
    await expect(logHarvestWaste(actor, { harvestId: harvest.id, weight: "1", unit: "G", reason: "x" })).rejects.toThrow(/finished/);

    const waste = await db.select().from(wasteLogs).where(eq(wasteLogs.sourceId, harvest.id));
    expect(waste.reduce((sum, w) => sum.add(w.weightGrams), new Decimal(0)).toString()).toBe("200");
    expect(await db.$count(packages, eq(packages.tag, `${run}-P0`))).toBe(0);
  });

  it("keeps facilities separate", async () => {
    const { batchId, ids } = await growPlants(1);
    await expect(changePlantPhase(other, { plantIds: ids, phase: "FLOWERING" })).rejects.toThrow(/not found/);
    await expect(tagPlants(other, { batchId, tags: nextTags(1) })).rejects.toThrow(/not found/);
    await expect(createPlantBatch(other, { name: `${run}-X`, strainId: strainA, source: "CLONE", count: "1", locationId: veg })).rejects.toThrow(/location/);
  });
});
