import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packageLineage, packages, productionRuns, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { receivePackage, setPackageStatus, type Actor } from "@/lib/inventory";
import { addRunInput, cancelRun, completeRun, createRecipe, removeRunInput, startRun } from "@/lib/manufacturing";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `M${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

let actor: Actor;
let other: Actor;
let flower: string;
let jar: string;
let jarred: string;
let gummies: string;
let shelf: string;
let recipeId: string;

const qtyOf = async (id: string) => {
  const [row] = await db.select().from(packages).where(eq(packages.id, id));
  return { quantity: new Decimal(row.quantity).toString(), status: row.status };
};

describe.skipIf(!hasDb)("manufacturing engine (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Mfg Org ${run}` }).returning();
    const [facility, second] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "Plant", licenseNumber: `${run}-A`, licenseType: "MANUFACTURING", state: "NM" },
        { orgId: org.id, name: "Other", licenseNumber: `${run}-B`, licenseType: "MANUFACTURING", state: "NM" },
      ])
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Maker", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "INVENTORY" })
      .returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Shelf", type: "RACK" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db
      .insert(items)
      .values([
        { orgId: org.id, name: "Bulk Flower", sku: "BULK", categoryId: category.id, unit: "G" },
        { orgId: org.id, name: "Empty Jar", sku: "JAR", categoryId: category.id, unit: "EACH" },
        { orgId: org.id, name: "3.5 g Jar", sku: "FIN", categoryId: category.id, unit: "EACH" },
        { orgId: org.id, name: "Gummies", sku: "GUM", categoryId: category.id, unit: "EACH" },
      ])
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    other = { ...actor, facilityId: second.id };
    shelf = location.id;
    [flower, jar, jarred, gummies] = made.map((i) => i.id);
    recipeId = (
      await createRecipe(actor, {
        name: "Jar 3.5",
        outputItemId: jarred,
        outputQuantity: "100",
        lines: [
          { itemId: flower, quantity: "350" },
          { itemId: jar, quantity: "100" },
        ],
      })
    ).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("validates recipes", async () => {
    const base = { name: "Bad", outputItemId: jarred, outputQuantity: "1" };
    await expect(createRecipe(actor, { ...base, lines: [] })).rejects.toThrow(/at least one input/);
    await expect(createRecipe(actor, { ...base, lines: [{ itemId: jarred, quantity: "1" }] })).rejects.toThrow(/own output/);
    await expect(
      createRecipe(actor, { ...base, lines: [{ itemId: flower, quantity: "1" }, { itemId: flower, quantity: "2" }] }),
    ).rejects.toThrow(/only be listed once/);
    await expect(createRecipe(actor, { ...base, name: "Jar 3.5", lines: [{ itemId: flower, quantity: "1" }] })).rejects.toThrow(/already a recipe/);
  });

  it("runs production end to end with lineage, lot, and cost", async () => {
    const bulk = await receivePackage(actor, { tag: tag(), itemId: flower, quantity: "1000", locationId: shelf, lotNumber: "LOT-7", costPerUnit: "1.2" });
    const jars = await receivePackage(actor, { tag: tag(), itemId: jar, quantity: "500", locationId: shelf, lotNumber: "LOT-7", costPerUnit: "0.35" });
    const stray = await receivePackage(actor, { tag: tag(), itemId: gummies, quantity: "10", locationId: shelf });

    const started = await startRun(actor, { name: `${run}-R1`, recipeId, batches: "2" });
    expect(new Decimal(started.plannedOutput).toString()).toBe("200");
    await expect(startRun(actor, { name: `${run}-R1`, recipeId, batches: "1" })).rejects.toThrow(/already has a run/);

    await expect(addRunInput(actor, { runId: started.id, tag: stray.tag, quantity: "1" })).rejects.toThrow(/not in this run's recipe/);
    await expect(addRunInput(actor, { runId: started.id, tag: bulk.tag, quantity: "1000.5" })).rejects.toThrow(/Not enough stock/);
    await addRunInput(actor, { runId: started.id, tag: bulk.tag, quantity: "700" });
    await expect(
      completeRun(actor, { runId: started.id, outputTag: tag(), actualQuantity: "196", locationId: shelf }),
    ).rejects.toThrow(/Nothing has been recorded for Empty Jar/);
    await addRunInput(actor, { runId: started.id, tag: jars.tag, quantity: "200" });
    expect((await qtyOf(bulk.id)).quantity).toBe("300");

    const { run: done, output } = await completeRun(actor, {
      runId: started.id,
      outputTag: tag(),
      actualQuantity: "196",
      locationId: shelf,
      extraCost: "70",
      lossNote: "4 jars underweight, flower returned to shake",
    });
    // inputs 700 x 1.2 + 200 x 0.35 = 910; plus 70 labor = 980; over 196 jars = 5 each
    expect(new Decimal(done.inputCost!).toString()).toBe("910");
    expect(new Decimal(done.costPerUnit!).toString()).toBe("5");
    expect(new Decimal(output.costPerUnit!).toString()).toBe("5");
    expect(output.lotNumber).toBe("LOT-7");
    expect(new Decimal(output.quantity).toString()).toBe("196");
    const parents = await db.select().from(packageLineage).where(eq(packageLineage.childId, output.id));
    expect(parents.map((p) => p.parentId).sort()).toEqual([bulk.id, jars.id].sort());

    await expect(addRunInput(actor, { runId: started.id, tag: bulk.tag, quantity: "1" })).rejects.toThrow(/completed/);
    await expect(cancelRun(actor, { runId: started.id })).rejects.toThrow(/completed/);
  });

  it("leaves cost unknown when an input has no cost, and uses the run name as lot for mixed lots", async () => {
    const bulk = await receivePackage(actor, { tag: tag(), itemId: flower, quantity: "350", locationId: shelf, lotNumber: "LOT-A", costPerUnit: "1" });
    const jars = await receivePackage(actor, { tag: tag(), itemId: jar, quantity: "100", locationId: shelf, lotNumber: "LOT-B" });
    const started = await startRun(actor, { name: `${run}-R2`, recipeId, batches: "1" });
    await addRunInput(actor, { runId: started.id, tag: bulk.tag, quantity: "350" });
    await addRunInput(actor, { runId: started.id, tag: jars.tag, quantity: "100" });
    expect(await qtyOf(bulk.id)).toEqual({ quantity: "0", status: "FINISHED" });
    const { run: done, output } = await completeRun(actor, { runId: started.id, outputTag: tag(), actualQuantity: "100", locationId: shelf });
    expect(done.inputCost).toBeNull();
    expect(done.costPerUnit).toBeNull();
    expect(output.costPerUnit).toBeNull();
    expect(output.lotNumber).toBe(`${run}-R2`);
  });

  it("returns product when an input is removed, and only cancels an empty run", async () => {
    const bulk = await receivePackage(actor, { tag: tag(), itemId: flower, quantity: "100", locationId: shelf });
    const started = await startRun(actor, { name: `${run}-R3`, recipeId, batches: "0.25" });
    await addRunInput(actor, { runId: started.id, tag: bulk.tag, quantity: "100" });
    expect(await qtyOf(bulk.id)).toEqual({ quantity: "0", status: "FINISHED" });
    await expect(cancelRun(actor, { runId: started.id })).rejects.toThrow(/Remove this run's inputs first/);

    const [row] = await db.execute<{ id: string }>(sql`select id from production_inputs where run_id = ${started.id}`).then((r) => r.rows);
    await removeRunInput(actor, { inputId: row.id });
    expect(await qtyOf(bulk.id)).toEqual({ quantity: "100", status: "ACTIVE" });
    await expect(removeRunInput(actor, { inputId: row.id })).rejects.toThrow(/already removed/);

    await cancelRun(actor, { runId: started.id });
    const [cancelled] = await db.select().from(productionRuns).where(eq(productionRuns.id, started.id));
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("refuses held packages, duplicate output tags, and other facilities", async () => {
    const bulk = await receivePackage(actor, { tag: tag(), itemId: flower, quantity: "400", locationId: shelf });
    const jars = await receivePackage(actor, { tag: tag(), itemId: jar, quantity: "100", locationId: shelf });
    const started = await startRun(actor, { name: `${run}-R4`, recipeId, batches: "1" });
    await setPackageStatus(actor, { packageId: bulk.id, status: "ON_HOLD", reason: "Awaiting test" });
    await expect(addRunInput(actor, { runId: started.id, tag: bulk.tag, quantity: "350" })).rejects.toThrow(/on hold/);
    await setPackageStatus(actor, { packageId: bulk.id, status: "ACTIVE", reason: "Passed" });
    await expect(addRunInput(other, { runId: started.id, tag: bulk.tag, quantity: "350" })).rejects.toThrow(/not found/);
    await addRunInput(actor, { runId: started.id, tag: bulk.tag, quantity: "350" });
    await addRunInput(actor, { runId: started.id, tag: jars.tag, quantity: "100" });
    await expect(
      completeRun(actor, { runId: started.id, outputTag: bulk.tag, actualQuantity: "100", locationId: shelf }),
    ).rejects.toThrow(/already in use/);
    const [still] = await db.select().from(productionRuns).where(eq(productionRuns.id, started.id));
    expect(still.status).toBe("IN_PROGRESS");
  });

  it("keeps the ledger consistent with package quantities", async () => {
    const rows = await db.execute(sql`
      select p.id from packages p join inventory_transactions t on t.package_id = p.id
      where p.org_id = ${actor.orgId} group by p.id, p.quantity having sum(t.quantity_delta) <> p.quantity
    `);
    expect(rows.rows).toHaveLength(0);
  });
});
