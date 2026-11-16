import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { facilities, itemCategories, items, locations, organizations, packages, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import {
  changePlantPhase,
  createPlantBatch,
  createStrain,
  createTask,
  harvestPlants,
  logHarvestWaste,
  tagPlants,
} from "@/lib/cultivation";
import { expandTags } from "@/lib/cultivation-math";
import { adjustPackage, movePackage, receivePackage, type Actor } from "@/lib/inventory";
import { createRecipe } from "@/lib/manufacturing";

const DEMO_PASSWORD = "demo1234";

async function main() {
  if ((await db.$count(users, eq(users.email, "owner@demo.test"))) > 0) {
    console.log("Demo data is already loaded; skipping seed.");
    return;
  }

  const [org] = await db.insert(organizations).values({ name: "High Desert Demo Co." }).returning();
  const [grow] = await db
    .insert(facilities)
    .values({
      orgId: org.id,
      name: "Rio Grande Grow & Lab",
      licenseNumber: "DEMO-CULT-0001",
      licenseType: "CULTIVATION",
      state: "NM",
    })
    .returning();
  const [shop] = await db
    .insert(facilities)
    .values({
      orgId: org.id,
      name: "Sandia Storefront",
      licenseNumber: "DEMO-RET-0002",
      licenseType: "RETAIL",
      state: "NM",
    })
    .returning();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const people = [
    ["Olivia Owner", "owner@demo.test", "OWNER"],
    ["Marcus Manager", "manager@demo.test", "MANAGER"],
    ["Ines Inventory", "inventory@demo.test", "INVENTORY"],
    ["Cal Cultivation", "cultivation@demo.test", "CULTIVATION"],
    ["Sam Sales", "sales@demo.test", "SALES"],
    ["Bea Budtender", "budtender@demo.test", "BUDTENDER"],
    ["Rae Readonly", "readonly@demo.test", "READ_ONLY"],
  ] as const;
  const createdUsers = await db
    .insert(users)
    .values(people.map(([name, email, role]) => ({ orgId: org.id, name, email, role, passwordHash })))
    .returning();
  const inventoryUser = createdUsers.find((u) => u.role === "INVENTORY")!;

  const locationNames: [string, string[]][] = [
    [grow.id, ["Vault A", "Vault A / Rack 1", "Vault A / Rack 2", "Dry Room", "Packaging Line", "Quarantine Cage", "Clone Room", "Veg Room", "Flower Room 1"]],
    [shop.id, ["Back Stock", "Sales Floor", "Returns Shelf"]],
  ];
  const locationId: Record<string, string> = {};
  for (const [facilityId, names] of locationNames) {
    const rows = await db
      .insert(locations)
      .values(
        names.map((name) => ({
          orgId: org.id,
          facilityId,
          name,
          type: name.includes("Rack") ? ("RACK" as const) : ("ROOM" as const),
        })),
      )
      .returning();
    for (const row of rows) locationId[`${facilityId}:${row.name}`] = row.id;
  }

  const categoryRows = await db
    .insert(itemCategories)
    .values(["Flower", "Pre-rolls", "Concentrates", "Edibles", "Trim", "Packaging"].map((name) => ({ orgId: org.id, name })))
    .returning();
  const categoryId = Object.fromEntries(categoryRows.map((c) => [c.name, c.id]));

  const itemRows = [
    ["Blue Mesa Flower (bulk)", "FLW-BM-BULK", "Flower", "G", "Blue Mesa"],
    ["Desert Haze Flower (bulk)", "FLW-DH-BULK", "Flower", "G", "Desert Haze"],
    ["Blue Mesa 3.5 g Jar", "FLW-BM-35", "Flower", "EACH", "Blue Mesa"],
    ["Desert Haze 1 g Pre-roll", "PR-DH-1", "Pre-rolls", "EACH", "Desert Haze"],
    ["Live Resin 1 g", "CON-LR-1", "Concentrates", "EACH", null],
    ["Prickly Pear Gummies 10-pack", "EDI-PP-10", "Edibles", "EACH", null],
    ["Mixed Trim", "TRM-MIX", "Trim", "KG", null],
    ["Empty 3.5 g Jar with Lid", "PKG-JAR", "Packaging", "EACH", null],
    ["Pre-roll Cone", "PKG-CONE", "Packaging", "EACH", null],
  ] as const;
  const createdItems = await db
    .insert(items)
    .values(
      itemRows.map(([name, sku, category, unit, strain]) => ({
        orgId: org.id,
        name,
        sku,
        categoryId: categoryId[category],
        unit,
        strain,
      })),
    )
    .returning();
  const itemId = Object.fromEntries(createdItems.map((i) => [i.sku, i.id]));

  const actor = (facilityId: string): Actor => ({
    userId: inventoryUser.id,
    userName: inventoryUser.name,
    orgId: org.id,
    facilityId,
  });

  const receipts = [
    [grow.id, "CT-000001", "FLW-BM-BULK", "4536", "Vault A / Rack 1", "LOT-BM-1101"],
    [grow.id, "CT-000002", "FLW-DH-BULK", "2268", "Vault A / Rack 1", "LOT-DH-1102"],
    [grow.id, "CT-000003", "FLW-BM-35", "480", "Vault A / Rack 2", "LOT-BM-1101"],
    [grow.id, "CT-000004", "PR-DH-1", "1200", "Packaging Line", "LOT-DH-1102"],
    [grow.id, "CT-000005", "CON-LR-1", "300", "Vault A", "LOT-LR-1028"],
    [grow.id, "CT-000006", "TRM-MIX", "18.5", "Dry Room", null],
    [grow.id, "CT-000007", "EDI-PP-10", "240", "Vault A / Rack 2", "LOT-PP-1030"],
    [grow.id, "CT-000008", "PKG-JAR", "2000", "Packaging Line", null],
    [grow.id, "CT-000009", "PKG-CONE", "5000", "Packaging Line", null],
    [shop.id, "CT-000101", "FLW-BM-35", "96", "Back Stock", "LOT-BM-1101"],
    [shop.id, "CT-000102", "PR-DH-1", "200", "Sales Floor", "LOT-DH-1102"],
    [shop.id, "CT-000103", "EDI-PP-10", "60", "Sales Floor", "LOT-PP-1030"],
  ] as const;
  // Rough demo costs per unit (dollars), so production runs can show a cost rollup.
  const demoCost: Record<string, string> = {
    "FLW-BM-BULK": "1.20",
    "FLW-DH-BULK": "1.05",
    "FLW-BM-35": "5.10",
    "PR-DH-1": "1.60",
    "CON-LR-1": "9.50",
    "EDI-PP-10": "4.25",
    "TRM-MIX": "90",
    "PKG-JAR": "0.35",
    "PKG-CONE": "0.08",
  };
  const packageId: Record<string, string> = {};
  for (const [facilityId, tag, sku, quantity, location, lotNumber] of receipts) {
    const pkg = await receivePackage(actor(facilityId), {
      tag,
      itemId: itemId[sku],
      quantity,
      locationId: locationId[`${facilityId}:${location}`],
      lotNumber,
      costPerUnit: demoCost[sku],
      note: "Opening inventory",
    });
    packageId[tag] = pkg.id;
  }

  await movePackage(actor(grow.id), {
    packageId: packageId["CT-000004"],
    toLocationId: locationId[`${grow.id}:Vault A / Rack 2`],
    note: "Packaging finished",
  });
  await adjustPackage(actor(grow.id), {
    packageId: packageId["CT-000002"],
    newQuantity: "2251.4",
    reasonCode: "DRYING",
    note: "Reweighed after cure",
  });
  // Demo only: holds get their own audited action in Phase 2.
  await db.update(packages).set({ status: "ON_HOLD" }).where(eq(packages.id, packageId["CT-000005"]));

  // Cultivation: two strains, plants at each stage, and one harvest hanging to dry.
  const grower = createdUsers.find((u) => u.role === "CULTIVATION")!;
  const growActor: Actor = { userId: grower.id, userName: grower.name, orgId: org.id, facilityId: grow.id };
  const room = (name: string) => locationId[`${grow.id}:${name}`];
  const blueMesa = await createStrain(growActor, { name: "Blue Mesa", type: "HYBRID", floweringDays: "63" });
  const desertHaze = await createStrain(growActor, { name: "Desert Haze", type: "SATIVA", floweringDays: "70" });

  await createPlantBatch(growActor, { name: "BM-CLONES-03", strainId: blueMesa.id, source: "CLONE", count: "48", locationId: room("Clone Room") });
  const vegBatch = await createPlantBatch(growActor, { name: "DH-CLONES-02", strainId: desertHaze.id, source: "CLONE", count: "24", locationId: room("Clone Room") });
  await tagPlants(growActor, { batchId: vegBatch.id, tags: expandTags("PL-000201", 20), locationId: room("Veg Room") });
  const flowerBatch = await createPlantBatch(growActor, { name: "BM-CLONES-02", strainId: blueMesa.id, source: "CLONE", count: "16", locationId: room("Clone Room") });
  const flowering = await tagPlants(growActor, { batchId: flowerBatch.id, tags: expandTags("PL-000101", 16), locationId: room("Flower Room 1") });
  await changePlantPhase(growActor, { plantIds: flowering.map((p) => p.id), phase: "FLOWERING" });
  const harvest = await harvestPlants(growActor, {
    plantIds: flowering.slice(0, 6).map((p) => p.id),
    name: "BM-1112",
    wetWeight: "9.6",
    unit: "KG",
    locationId: room("Dry Room"),
  });
  await logHarvestWaste(growActor, { harvestId: harvest.id, weight: "850", unit: "G", reason: "Fan leaves and stems" });
  await createTask(growActor, { title: "Defoliate Flower Room 1", locationId: room("Flower Room 1") });
  await createTask(growActor, { title: "Check dry room humidity", locationId: room("Dry Room") });

  // Manufacturing: two recipes ready to run.
  await createRecipe(actor(grow.id), {
    name: "Blue Mesa 3.5 g jars (100)",
    outputItemId: itemId["FLW-BM-35"],
    outputQuantity: "100",
    lines: [
      { itemId: itemId["FLW-BM-BULK"], quantity: "350" },
      { itemId: itemId["PKG-JAR"], quantity: "100" },
    ],
  });
  await createRecipe(actor(grow.id), {
    name: "Desert Haze 1 g pre-rolls (500)",
    outputItemId: itemId["PR-DH-1"],
    outputQuantity: "500",
    lines: [
      { itemId: itemId["FLW-DH-BULK"], quantity: "500" },
      { itemId: itemId["PKG-CONE"], quantity: "500" },
    ],
  });

  console.log(`Seeded "${org.name}". Sign in as owner@demo.test / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
