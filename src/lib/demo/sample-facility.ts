import "server-only";
import { and, eq } from "drizzle-orm";
import { facilities, itemCategories, items, locations, orderLines, packages, strains, type roomAreaEnum } from "@/db/schema";
import { db } from "@/lib/db";
import { changePlantPhase, createPlantBatch, createStrain, createTask, destroyPlants, finishHarvest, harvestPlants, logHarvestWaste, packageFromHarvest, recordDryWeight, tagPlants } from "@/lib/cultivation";
import { expandTags } from "@/lib/cultivation-math";
import { allocateToOrder, confirmOrder, createCustomer, createDriver, createOrder, addOrderLine, createPriceList, createVehicle, setCustomerPriceList, setPrice, verifyCustomerLicense } from "@/lib/distribution";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addFacility } from "@/lib/facilities";
import { addLabResult, movePackage, receivePackage, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { addRunInput, completeRun, createRecipe, startRun } from "@/lib/manufacturing";
import { addToCart, checkInCustomer, completeSale, createDiscount, openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";
import { processQueue } from "@/lib/sync";

/**
 * Fill a new facility in an existing business with a complete, realistic operation so the owner can
 * try every part of Leaf2Sale without touching their real facilities. Everything is made through
 * the same functions people use, so it follows the same rules and is in the audit trail.
 * Records are marked "sample" (tags start SMP-, SKUs start SMP-) so they're easy to tell apart.
 */

export const SAMPLE_FACILITY_NAME = "Sample Grow & Store (practice data)";
export const SAMPLE_LICENSE = "SAMPLE-NM-0001";

type Who = { orgId: string; userId: string; userName: string };
type Area = (typeof roomAreaEnum.enumValues)[number];

export async function sampleFacilityFor(orgId: string) {
  const [f] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.orgId, orgId), eq(facilities.licenseNumber, SAMPLE_LICENSE)));
  return f ?? null;
}

export async function loadSampleFacility(who: Who): Promise<{ facilityId: string; summary: string }> {
  if (await sampleFacilityFor(who.orgId)) throw new InventoryError("The sample facility is already loaded. Switch to it from the facility menu at the top.");
  const [taken] = await db.select({ id: items.id }).from(items).where(and(eq(items.orgId, who.orgId), eq(items.sku, "SMP-FLW-BM-BULK")));
  if (taken) throw new InventoryError("Sample items already exist in this business. The sample facility was loaded before.");

  const facility = await addFacility({ ...who, facilityId: "" }, { name: SAMPLE_FACILITY_NAME, licenseNumber: SAMPLE_LICENSE, licenseType: "MICROBUSINESS", state: "NM" });
  const actor: Actor = { ...who, facilityId: facility.id };

  // ---------------------------------------------------------------- rooms, one for every area type
  const rooms: [string, "ROOM" | "RACK", Area | null][] = [
    ["Clone Room", "ROOM", "PROPAGATION"],
    ["Mother Room", "ROOM", "PROPAGATION"],
    ["Veg Room A", "ROOM", "VEGETATIVE"],
    ["Flower Room 1", "ROOM", "FLOWERING"],
    ["Flower Room 2", "ROOM", "FLOWERING"],
    ["Harvest Room", "ROOM", "HARVEST"],
    ["Dry & Trim Room", "ROOM", "DRYING_TRIMMING"],
    ["Vault", "ROOM", "INVENTORY"],
    ["Vault / Rack 1", "RACK", null],
    ["Vault / Rack 2", "RACK", null],
    ["Packaging Line", "ROOM", "INVENTORY"],
    ["Sales Floor", "ROOM", "INVENTORY"],
    ["Quarantine Cage", "ROOM", "QUARANTINE"],
    ["Waste Cage", "ROOM", "WASTE"],
  ];
  const made = await db
    .insert(locations)
    .values(rooms.map(([name, type, area]) => ({ orgId: who.orgId, facilityId: facility.id, name, type, area })))
    .returning();
  const room = (name: string) => made.find((l) => l.name === name)!.id;

  // ---------------------------------------------------------------- catalog (shared across the business)
  const categoryNames = ["Flower", "Pre-rolls", "Concentrates", "Edibles", "Beverages", "Topicals", "Trim", "Packaging"];
  await db
    .insert(itemCategories)
    .values(categoryNames.map((name) => ({ orgId: who.orgId, name })))
    .onConflictDoNothing({ target: [itemCategories.orgId, itemCategories.name] });
  const cats = await db.select().from(itemCategories).where(eq(itemCategories.orgId, who.orgId));
  const category = (name: string) => cats.find((c) => c.name === name)!.id;

  // Strains are shared too: reuse one the business already has under the same name.
  const strainId: Record<string, string> = {};
  for (const [name, type, days] of [
    ["Blue Mesa", "HYBRID", "63"],
    ["Desert Haze", "SATIVA", "70"],
    ["Sandia Sunset", "INDICA", "56"],
    ["Green Chile OG", "HYBRID", "60"],
  ] as const) {
    const [existing] = await db.select({ id: strains.id }).from(strains).where(and(eq(strains.orgId, who.orgId), eq(strains.name, name)));
    strainId[name] = existing?.id ?? (await createStrain(actor, { name, type, floweringDays: days })).id;
  }

  const flowerUse = { directions: "For inhalation. Grind, roll or pack, light, and inhale slowly.", pesticides: "None", shelfLifeDays: 365 };
  type ItemRow = { name: string; sku: string; category: string; unit: "G" | "KG" | "EACH"; strain?: string; details?: Partial<typeof items.$inferInsert> };
  const itemRows: ItemRow[] = [
    { name: "Blue Mesa Flower (bulk)", sku: "SMP-FLW-BM-BULK", category: "Flower", unit: "G", strain: "Blue Mesa", details: flowerUse },
    { name: "Desert Haze Flower (bulk)", sku: "SMP-FLW-DH-BULK", category: "Flower", unit: "G", strain: "Desert Haze", details: flowerUse },
    { name: "Sandia Sunset Flower (bulk)", sku: "SMP-FLW-SS-BULK", category: "Flower", unit: "G", strain: "Sandia Sunset", details: flowerUse },
    { name: "Blue Mesa 3.5 g Jar", sku: "SMP-FLW-BM-35", category: "Flower", unit: "EACH", strain: "Blue Mesa", details: { unitWeightGrams: "3.5", ...flowerUse } },
    { name: "Sandia Sunset 3.5 g Jar", sku: "SMP-FLW-SS-35", category: "Flower", unit: "EACH", strain: "Sandia Sunset", details: { unitWeightGrams: "3.5", ...flowerUse } },
    { name: "Desert Haze 1 g Pre-roll", sku: "SMP-PR-DH-1", category: "Pre-rolls", unit: "EACH", strain: "Desert Haze", details: { unitWeightGrams: "1", ...flowerUse } },
    {
      name: "Green Chile OG Live Resin 1 g",
      sku: "SMP-CON-GC-1",
      category: "Concentrates",
      unit: "EACH",
      strain: "Green Chile OG",
      details: { unitWeightGrams: "1", directions: "For inhalation. Heat a small amount in a dab rig or vaporizer and inhale.", pesticides: "None", solvents: "Butane, propane", shelfLifeDays: 365 },
    },
    {
      name: "Prickly Pear Gummies 10-pack",
      sku: "SMP-EDI-PP-10",
      category: "Edibles",
      unit: "EACH",
      details: {
        unitWeightGrams: "50",
        servingsPerUnit: 10,
        thcMgPerServing: "10",
        directions: "For oral use. Eat one gummy and wait at least two hours before eating more.",
        ingredients: "Sugar, tapioca syrup, water, pectin, citric acid, prickly pear juice, cannabis distillate, natural flavor",
        pesticides: "None",
        solvents: "Ethanol",
        shelfLifeDays: 180,
      },
    },
    {
      name: "Horchata Cold Brew 10 mg",
      sku: "SMP-BEV-HC-10",
      category: "Beverages",
      unit: "EACH",
      details: {
        unitWeightGrams: "355",
        servingsPerUnit: 1,
        thcMgPerServing: "10",
        cbdMgPerServing: "0.5",
        directions: "For oral use. Shake well. Drink slowly and wait at least two hours before having more.",
        ingredients: "Cold brew coffee, oat milk, cane sugar, rice, cinnamon, vanilla, cannabis emulsion",
        allergens: "Contains: oats (processed in a facility with tree nuts)",
        pesticides: "None",
        solvents: "Ethanol",
        mustRefrigerate: true,
        shelfLifeDays: 45,
      },
    },
    {
      name: "Lavender Relief Balm 1 oz",
      sku: "SMP-TOP-LB-1",
      category: "Topicals",
      unit: "EACH",
      details: {
        unitWeightGrams: "28.35",
        directions: "For topical use only. Rub a small amount onto skin. Do not eat.",
        ingredients: "Shea butter, coconut oil, beeswax, cannabis infused oil, lavender essential oil, vitamin E",
        pesticides: "None",
        solvents: "Ethanol",
        shelfLifeDays: 365,
      },
    },
    { name: "Mixed Trim", sku: "SMP-TRM-MIX", category: "Trim", unit: "KG" },
    { name: "Empty 3.5 g Jar with Lid", sku: "SMP-PKG-JAR", category: "Packaging", unit: "EACH" },
    { name: "Pre-roll Cone", sku: "SMP-PKG-CONE", category: "Packaging", unit: "EACH" },
  ];
  const createdItems = await db
    .insert(items)
    .values(itemRows.map((r) => ({ orgId: who.orgId, name: r.name, sku: r.sku, categoryId: category(r.category), unit: r.unit, strain: r.strain ?? null, ...r.details })))
    .returning();
  const item = (sku: string) => createdItems.find((i) => i.sku === sku)!.id;

  // ---------------------------------------------------------------- opening inventory with lab results
  const pkg: Record<string, string> = {};
  const receive = async (tag: string, sku: string, quantity: string, at: string, lot: string | null, cost: string) => {
    pkg[tag] = (await receivePackage(actor, { tag, itemId: item(sku), quantity, locationId: room(at), lotNumber: lot, costPerUnit: cost, note: "Sample opening inventory" })).id;
  };
  await receive("SMP-000001", "SMP-FLW-BM-BULK", "4536", "Vault / Rack 1", "LOT-BM-1101", "1.20");
  await receive("SMP-000002", "SMP-FLW-DH-BULK", "2268", "Vault / Rack 1", "LOT-DH-1102", "1.05");
  await receive("SMP-000003", "SMP-FLW-BM-35", "240", "Vault / Rack 2", "LOT-BM-1101", "5.10");
  await receive("SMP-000004", "SMP-PR-DH-1", "600", "Vault / Rack 2", "LOT-DH-1102", "1.60");
  await receive("SMP-000005", "SMP-CON-GC-1", "150", "Vault", "LOT-GC-1028", "9.50");
  await receive("SMP-000006", "SMP-EDI-PP-10", "120", "Vault", "LOT-PP-1030", "4.25");
  await receive("SMP-000007", "SMP-BEV-HC-10", "48", "Vault", "LOT-HC-1105", "2.10");
  await receive("SMP-000008", "SMP-TOP-LB-1", "36", "Vault", "LOT-LB-1020", "6.00");
  await receive("SMP-000009", "SMP-TRM-MIX", "12.5", "Dry & Trim Room", null, "90");
  await receive("SMP-000010", "SMP-PKG-JAR", "2000", "Packaging Line", null, "0.35");
  await receive("SMP-000011", "SMP-PKG-CONE", "5000", "Packaging Line", null, "0.08");
  await receive("SMP-000012", "SMP-FLW-DH-BULK", "900", "Vault / Rack 1", "LOT-DH-1109", "1.05");
  await receive("SMP-000013", "SMP-FLW-BM-BULK", "1200", "Vault / Rack 1", "LOT-BM-1112", "1.20");
  await receive("SMP-000101", "SMP-FLW-BM-35", "60", "Sales Floor", "LOT-BM-1101", "5.10");
  await receive("SMP-000102", "SMP-PR-DH-1", "150", "Sales Floor", "LOT-DH-1102", "1.60");
  await receive("SMP-000103", "SMP-EDI-PP-10", "40", "Sales Floor", "LOT-PP-1030", "4.25");
  await receive("SMP-000104", "SMP-CON-GC-1", "30", "Sales Floor", "LOT-GC-1028", "9.50");
  await receive("SMP-000105", "SMP-BEV-HC-10", "24", "Sales Floor", "LOT-HC-1105", "2.10");
  await receive("SMP-000106", "SMP-TOP-LB-1", "12", "Sales Floor", "LOT-LB-1020", "6.00");

  const flowerProfile = (thc: number) => ({
    thcPercent: thc.toFixed(1),
    cbdPercent: "0.1",
    profile: {
      thcaPercent: (thc * 1.09).toFixed(1),
      d9ThcPercent: "0.6",
      cbdaPercent: "0.1",
      totalCbdPercent: "0.1",
      cbgPercent: "1.2",
      cbnPercent: "0.1",
      totalCannabinoidsPercent: (thc * 1.16).toFixed(1),
    },
  });
  const lab = async (tag: string, status: "PASS" | "FAIL" | "PENDING", values: Record<string, unknown>, notes?: string) =>
    addLabResult(actor, { packageId: pkg[tag], labName: "Sample Analytical Labs", status, sampleDate: addDays(todayIn(), -7), notes, ...values });
  const terps = {
    "Blue Mesa": "Myrcene 0.82%, Limonene 0.41%, Caryophyllene 0.30%",
    "Desert Haze": "Terpinolene 0.91%, Ocimene 0.33%, Myrcene 0.21%",
    "Green Chile OG": "Limonene 1.40%, Caryophyllene 0.88%, Linalool 0.35%",
  };
  for (const tag of ["SMP-000001", "SMP-000003", "SMP-000101"]) await lab(tag, "PASS", { ...flowerProfile(24.1), terpenes: terps["Blue Mesa"] });
  for (const tag of ["SMP-000002", "SMP-000004", "SMP-000102"]) await lab(tag, "PASS", { ...flowerProfile(22.8), terpenes: terps["Desert Haze"] });
  for (const tag of ["SMP-000005", "SMP-000104"]) await lab(tag, "PASS", { thcPercent: "78.4", cbdPercent: "0.3", profile: { thcaPercent: "84.2", d9ThcPercent: "4.6", cbgPercent: "2.1", totalCannabinoidsPercent: "86.9" }, terpenes: terps["Green Chile OG"] });
  for (const tag of ["SMP-000006", "SMP-000103"]) await lab(tag, "PASS", { thcPercent: "0.2", profile: { d9ThcPercent: "0.2", totalCannabinoidsPercent: "0.2" } });
  for (const tag of ["SMP-000007", "SMP-000105"]) await lab(tag, "PASS", { thcPercent: "0.003", cbdPercent: "0.0001" });
  for (const tag of ["SMP-000008", "SMP-000106"]) await lab(tag, "PASS", { thcPercent: "0.7", cbdPercent: "0.4" });
  // One batch failed (it quarantines itself) and one is still waiting on the lab.
  await lab("SMP-000012", "FAIL", { thcPercent: "21.0" }, "Total yeast and mold over the action limit");
  await movePackage(actor, { packageId: pkg["SMP-000012"], toLocationId: room("Quarantine Cage"), note: "Failed microbial test" });
  await lab("SMP-000013", "PENDING", {});

  // ---------------------------------------------------------------- cultivation: about 100 plants at every stage
  await createPlantBatch(actor, { name: "GCO-CLONES-04", strainId: strainId["Green Chile OG"], source: "CLONE", count: "48", locationId: room("Clone Room") });
  const veg = await createPlantBatch(actor, { name: "DH-CLONES-03", strainId: strainId["Desert Haze"], source: "CLONE", count: "42", locationId: room("Clone Room") });
  const vegPlants = await tagPlants(actor, { batchId: veg.id, tags: expandTags("SMP-PL-0001", 40), locationId: room("Veg Room A") });
  const bm = await createPlantBatch(actor, { name: "BM-CLONES-02", strainId: strainId["Blue Mesa"], source: "CLONE", count: "36", locationId: room("Clone Room") });
  const bmPlants = await tagPlants(actor, { batchId: bm.id, tags: expandTags("SMP-PL-0101", 36), locationId: room("Flower Room 1") });
  await changePlantPhase(actor, { plantIds: bmPlants.map((p) => p.id), phase: "FLOWERING" });
  const ss = await createPlantBatch(actor, { name: "SS-SEEDS-01", strainId: strainId["Sandia Sunset"], source: "SEED", count: "32", locationId: room("Clone Room") });
  const ssPlants = await tagPlants(actor, { batchId: ss.id, tags: expandTags("SMP-PL-0201", 32), locationId: room("Flower Room 2") });
  await changePlantPhase(actor, { plantIds: ssPlants.map((p) => p.id), phase: "FLOWERING" });
  await destroyPlants(actor, { plantIds: [vegPlants[39].id, ssPlants[31].id], reason: "Hermaphrodite, removed before pollination", wasteGrams: "0.6", wasteUnit: "KG" });

  // A finished harvest: dried, trimmed, packaged, and closed out to the gram.
  const done = await harvestPlants(actor, { plantIds: ssPlants.slice(0, 12).map((p) => p.id), name: "SS-H-1104", wetWeight: "18", unit: "KG", locationId: room("Dry & Trim Room") });
  await recordDryWeight(actor, { harvestId: done.id, dryWeight: "3.6", unit: "KG" });
  await logHarvestWaste(actor, { harvestId: done.id, weight: "600", unit: "G", reason: "Stems and fan leaves" });
  pkg["SMP-000020"] = (await packageFromHarvest(actor, { harvestId: done.id, tag: "SMP-000020", itemId: item("SMP-FLW-SS-BULK"), quantity: "2500", locationId: room("Vault / Rack 1") })).id;
  pkg["SMP-000021"] = (await packageFromHarvest(actor, { harvestId: done.id, tag: "SMP-000021", itemId: item("SMP-TRM-MIX"), quantity: "0.5", locationId: room("Dry & Trim Room") })).id;
  await finishHarvest(actor, { harvestId: done.id });
  await lab("SMP-000020", "PASS", { ...flowerProfile(26.3), terpenes: "Myrcene 1.10%, Linalool 0.44%, Caryophyllene 0.38%" });
  // A harvest hanging to dry right now.
  const drying = await harvestPlants(actor, { plantIds: bmPlants.slice(0, 8).map((p) => p.id), name: "BM-H-1115", wetWeight: "12.4", unit: "KG", locationId: room("Dry & Trim Room") });
  await logHarvestWaste(actor, { harvestId: drying.id, weight: "1.1", unit: "KG", reason: "Fan leaves" });

  for (const [title, at, due] of [
    ["Defoliate Flower Room 1", "Flower Room 1", 1],
    ["Check Dry & Trim humidity (target 60%)", "Dry & Trim Room", 0],
    ["Transplant DH-CLONES-03 to 3-gallon pots", "Veg Room A", 3],
    ["Take cuts from Green Chile OG mothers", "Mother Room", 5],
  ] as const) {
    await createTask(actor, { title, locationId: room(at), dueDate: addDays(todayIn(), due) });
  }

  // ---------------------------------------------------------------- manufacturing: jar the finished harvest
  const recipe = await createRecipe(actor, {
    name: "Sandia Sunset 3.5 g jars (100)",
    outputItemId: item("SMP-FLW-SS-35"),
    outputQuantity: "100",
    lines: [
      { itemId: item("SMP-FLW-SS-BULK"), quantity: "350" },
      { itemId: item("SMP-PKG-JAR"), quantity: "100" },
    ],
  });
  await createRecipe(actor, {
    name: "Desert Haze 1 g pre-rolls (500)",
    outputItemId: item("SMP-PR-DH-1"),
    outputQuantity: "500",
    lines: [
      { itemId: item("SMP-FLW-DH-BULK"), quantity: "500" },
      { itemId: item("SMP-PKG-CONE"), quantity: "500" },
    ],
  });
  const run = await startRun(actor, { name: "RUN-SS-01", recipeId: recipe.id, batches: "2" });
  await addRunInput(actor, { runId: run.id, tag: "SMP-000020", quantity: "700" });
  await addRunInput(actor, { runId: run.id, tag: "SMP-000010", quantity: "200" });
  await completeRun(actor, { runId: run.id, outputTag: "SMP-000030", actualQuantity: "198", locationId: room("Vault / Rack 2"), lossNote: "Two jars short on weight, flower returned to bulk" });
  const [jars] = await db.select({ id: packages.id }).from(packages).where(and(eq(packages.orgId, who.orgId), eq(packages.tag, "SMP-000030")));
  pkg["SMP-000030"] = jars.id;
  await lab("SMP-000030", "PASS", { ...flowerProfile(26.3), terpenes: "Myrcene 1.10%, Linalool 0.44%, Caryophyllene 0.38%" });

  // ---------------------------------------------------------------- wholesale
  const wholesale = await createPriceList(actor, { name: "Sample wholesale" });
  for (const [sku, price] of Object.entries({ "SMP-FLW-BM-35": "12.50", "SMP-FLW-SS-35": "13.00", "SMP-PR-DH-1": "2.75", "SMP-CON-GC-1": "18", "SMP-EDI-PP-10": "8.50" })) {
    await setPrice(actor, { priceListId: wholesale.id, itemId: item(sku), price });
  }
  const shop = await createCustomer(actor, {
    name: "Sample: Turquoise Trail Dispensary",
    licenseNumber: "SAMPLE-RET-0417",
    licenseType: "Retailer",
    licenseExpires: addDays(todayIn(), 240),
    contactName: "Jo Martinez",
    address: "2810 Cerrillos Rd, Santa Fe, NM",
    paymentTermsDays: "15",
  });
  await verifyCustomerLicense(actor, { customerId: shop.id });
  await setCustomerPriceList(actor, { customerId: shop.id, priceListId: wholesale.id });
  await createCustomer(actor, {
    name: "Sample: Bosque Wellness",
    licenseNumber: "SAMPLE-RET-0533",
    licenseType: "Retailer",
    licenseExpires: addDays(todayIn(), 90),
    address: "415 Rio Grande Blvd NW, Albuquerque, NM",
  });
  await createCustomer(actor, {
    name: "Sample: Sandoval Packaging Supply",
    licenseNumber: "SAMPLE-SUP-0090",
    licenseType: "Ancillary supplier",
    licenseExpires: addDays(todayIn(), 365),
    weSellTo: false,
    weBuyFrom: true,
  });
  await createDriver(actor, { name: "Dana Ortiz (sample)", licenseNumber: "SAMPLE-DL-0001", phone: "505-555-0142" });
  await createVehicle(actor, { make: "Ford", model: "Transit Connect", plate: "SAMPLE-1" });
  // One order picked and ready to pack, one still a draft.
  const order = await createOrder(actor, { customerId: shop.id, notes: "Sample order: weekly restock" });
  await addOrderLine(actor, { orderId: order.id, itemId: item("SMP-FLW-BM-35"), quantity: "50" });
  await addOrderLine(actor, { orderId: order.id, itemId: item("SMP-PR-DH-1"), quantity: "100" });
  await confirmOrder(actor, { orderId: order.id });
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
  const lineFor = (sku: string) => lines.find((l) => l.itemId === item(sku))!.id;
  await allocateToOrder(actor, { orderId: order.id, lineId: lineFor("SMP-FLW-BM-35"), tag: "SMP-000003", quantity: "50", newTag: "SMP-000201" });
  await allocateToOrder(actor, { orderId: order.id, lineId: lineFor("SMP-PR-DH-1"), tag: "SMP-000004", quantity: "100", newTag: "SMP-000202" });
  const draft = await createOrder(actor, { customerId: shop.id, notes: "Sample draft order" });
  await addOrderLine(actor, { orderId: draft.id, itemId: item("SMP-CON-GC-1"), quantity: "20" });

  // ---------------------------------------------------------------- the storefront
  // Placeholder tax rates for practice only. A real store enters its own under Register → Menu and store rules.
  await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "7.5", medicalTaxExempt: true });
  for (const [sku, price, limitCategory, limitPerUnit] of [
    ["SMP-FLW-BM-35", "35", "FLOWER", "3.5"],
    ["SMP-FLW-SS-35", "38", "FLOWER", "3.5"],
    ["SMP-PR-DH-1", "8", "FLOWER", "1"],
    ["SMP-CON-GC-1", "45", "CONCENTRATE", "1"],
    ["SMP-EDI-PP-10", "22", "EDIBLE", "100"],
    ["SMP-BEV-HC-10", "9", "EDIBLE", "10"],
    ["SMP-TOP-LB-1", "28", "NONE", null],
  ] as const) {
    await setMenuItem(actor, { itemId: item(sku), price, limitCategory, limitPerUnit });
  }
  await createDiscount(actor, { name: "Veteran", percent: "10" });
  await createDiscount(actor, { name: "Senior", percent: "15" });
  await openDrawer(actor, { openingCash: "200" });
  const adult = { birthDate: "1988-04-12", idExpires: addDays(todayIn(), 700), customerType: "ADULT_USE" };
  for (const cart of [
    [["SMP-FLW-BM-35", "2"], ["SMP-PR-DH-1", "3"]],
    [["SMP-EDI-PP-10", "1"], ["SMP-BEV-HC-10", "2"]],
    [["SMP-CON-GC-1", "1"], ["SMP-TOP-LB-1", "1"]],
  ] as const) {
    const sale = await checkInCustomer(actor, adult);
    for (const [sku, qty] of cart) await addToCart(actor, { saleId: sale.id, itemId: item(sku), quantity: qty });
    await completeSale(actor, { saleId: sale.id, paymentMethod: "CASH", cashTendered: "200" });
  }

  // Practice mode: state reporting records show as sent.
  await processQueue({ facilityId: facility.id });

  return {
    facilityId: facility.id,
    summary: `Loaded ${SAMPLE_FACILITY_NAME}: 12 rooms and 2 vault racks, 4 strains, about 100 plants, 2 harvests, ${Object.keys(pkg).length + 2} packages, 13 products, 2 orders, and 3 register sales.`,
  };
}
