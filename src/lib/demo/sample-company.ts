import { eq } from "drizzle-orm";
import { destinations, facilities, itemCategories, items, locations, organizations, packages, roomAreaEnum, users } from "@/db/schema";
import { db } from "@/lib/db";
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
import { addLabResult, adjustPackage, movePackage, receivePackage, type Actor } from "@/lib/inventory";
import { createCustomer, createDestination, createDriver, createPriceList, createVehicle, setPrice, verifyCustomerLicense, verifyDestinationLicense } from "@/lib/distribution";
import { addDays, todayIn } from "@/lib/distribution-math";
import { createRecipe } from "@/lib/manufacturing";
import { createDiscount, saveRetailSettings, setMenuItem } from "@/lib/pos";
import { processQueue } from "@/lib/sync";

export type SeedOptions = {
  /** Fill an organization that already exists (the live demo creates its row first), or create one with orgName. */
  orgId?: string;
  orgName: string;
  /** Domain for the sample team's email addresses, e.g. demo.test. */
  emailDomain: string;
  passwordHash: string;
};

/**
 * Load a complete sample business: two facilities, a team, inventory with lab results,
 * plants and a harvest, recipes, wholesale customers, and a retail menu.
 * Used by the local seed script and by the public live demo.
 */
export async function seedSampleCompany(opts: SeedOptions) {
  const [org] = opts.orgId
    ? await db.select().from(organizations).where(eq(organizations.id, opts.orgId))
    : await db.insert(organizations).values({ name: opts.orgName }).returning();
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

  const passwordHash = opts.passwordHash;
  const people = [
    ["Olivia Owner", `owner@${opts.emailDomain}`, "OWNER"],
    ["Marcus Manager", `manager@${opts.emailDomain}`, "MANAGER"],
    ["Ines Inventory", `inventory@${opts.emailDomain}`, "INVENTORY"],
    ["Cal Cultivation", `cultivation@${opts.emailDomain}`, "CULTIVATION"],
    ["Sam Sales", `sales@${opts.emailDomain}`, "SALES"],
    ["Bea Budtender", `budtender@${opts.emailDomain}`, "BUDTENDER"],
    ["Rae Readonly", `readonly@${opts.emailDomain}`, "READ_ONLY"],
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
  const demoAreas: Record<string, (typeof roomAreaEnum.enumValues)[number]> = {
    "Vault A": "INVENTORY",
    "Dry Room": "DRYING_TRIMMING",
    "Packaging Line": "INVENTORY",
    "Quarantine Cage": "QUARANTINE",
    "Clone Room": "PROPAGATION",
    "Veg Room": "VEGETATIVE",
    "Flower Room 1": "FLOWERING",
    "Back Stock": "INVENTORY",
    "Sales Floor": "INVENTORY",
    "Returns Shelf": "QUARANTINE",
  };
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
          area: demoAreas[name] ?? null,
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

  // Label details, so the demo's product labels show net weight, directions, and expiration dates.
  const flowerUse = { directions: "For inhalation. Grind, roll or pack, light, and inhale slowly.", pesticides: "None", shelfLifeDays: 365 };
  const labelDetails: Record<string, Partial<typeof items.$inferInsert>> = {
    "FLW-BM-35": { unitWeightGrams: "3.5", ...flowerUse },
    "PR-DH-1": { unitWeightGrams: "1", ...flowerUse },
    "CON-LR-1": { unitWeightGrams: "1", directions: "For inhalation. Heat a small amount and inhale.", pesticides: "None", solvents: "Butane, propane", shelfLifeDays: 365 },
    "EDI-PP-10": {
      unitWeightGrams: "50",
      servingsPerUnit: 10,
      thcMgPerServing: "10",
      directions: "For oral use. Eat one gummy and wait at least two hours before eating more.",
      ingredients: "Sugar, tapioca syrup, water, pectin, citric acid, prickly pear juice, cannabis distillate, natural flavor",
      pesticides: "None",
      solvents: "Ethanol",
      shelfLifeDays: 180,
    },
  };
  for (const [sku, details] of Object.entries(labelDetails)) await db.update(items).set(details).where(eq(items.id, itemId[sku]));

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

  // Finished products carry a passing lab result, as New Mexico requires before retail sale.
  for (const [facilityId, tag, thc] of [
    [grow.id, "CT-000003", "24.1"],
    [grow.id, "CT-000004", "22.8"],
    [grow.id, "CT-000007", "0.9"],
    [shop.id, "CT-000101", "24.1"],
    [shop.id, "CT-000102", "22.8"],
    [shop.id, "CT-000103", "0.9"],
  ] as const) {
    const flower = Number(thc) > 5;
    await addLabResult(actor(facilityId), {
      packageId: packageId[tag],
      labName: "Demo Testing Lab",
      status: "PASS",
      thcPercent: thc,
      cbdPercent: flower ? "0.1" : null,
      // A made-up but realistic profile: THCa makes up most of the total THC in flower.
      profile: flower ? { thcaPercent: (Number(thc) * 1.08).toFixed(1), d9ThcPercent: "0.6", cbgPercent: "1.2", cbnPercent: "0.1", totalCannabinoidsPercent: (Number(thc) * 1.15).toFixed(1) } : undefined,
      terpenes: flower ? "Myrcene 0.82%, Limonene 0.41%, Caryophyllene 0.30%" : null,
    });
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

  // Distribution: wholesale prices, two customers (one not yet verified), a driver, and a van.
  const seller = createdUsers.find((u) => u.role === "SALES")!;
  const salesActor: Actor = { userId: seller.id, userName: seller.name, orgId: org.id, facilityId: grow.id };
  const wholesale = await createPriceList(salesActor, { name: "Standard wholesale" });
  const wholesalePrices: Record<string, string> = {
    "FLW-BM-BULK": "2.40",
    "FLW-DH-BULK": "2.10",
    "FLW-BM-35": "12.50",
    "PR-DH-1": "2.75",
    "CON-LR-1": "18",
    "EDI-PP-10": "8.50",
  };
  for (const [sku, price] of Object.entries(wholesalePrices)) {
    await setPrice(salesActor, { priceListId: wholesale.id, itemId: itemId[sku], price });
  }
  const verified = await createCustomer(salesActor, {
    name: "Turquoise Trail Dispensary",
    licenseNumber: "DEMO-RET-0417",
    licenseType: "Retailer",
    licenseExpires: addDays(todayIn(), 240),
    contactName: "Jo Martinez",
    address: "2810 Cerrillos Rd, Santa Fe, NM",
    paymentTermsDays: "15",
  });
  await verifyCustomerLicense(salesActor, { customerId: verified.id });
  // Its own store is its first destination; it has a second store too. Both licenses checked.
  const [main] = await db.select({ id: destinations.id }).from(destinations).where(eq(destinations.vendorId, verified.id));
  await verifyDestinationLicense(salesActor, { destinationId: main.id });
  const second = await createDestination(salesActor, {
    vendorId: verified.id,
    name: "Turquoise Trail – Madrid",
    licenseNumber: "DEMO-RET-0418",
    licenseType: "Retailer",
    licenseExpires: addDays(todayIn(), 200),
    address: "2860 NM-14, Madrid, NM",
  });
  await verifyDestinationLicense(salesActor, { destinationId: second.id });
  await createCustomer(salesActor, {
    name: "Bosque Wellness",
    licenseNumber: "DEMO-RET-0533",
    licenseType: "Retailer",
    licenseExpires: addDays(todayIn(), 90),
    address: "415 Rio Grande Blvd NW, Albuquerque, NM",
  });
  // A supplier: a vendor we buy from.
  await createCustomer(salesActor, {
    name: "Sandoval Packaging Supply",
    licenseNumber: "DEMO-SUP-0090",
    licenseType: "Ancillary supplier",
    licenseExpires: addDays(todayIn(), 365),
    weSellTo: false,
    weBuyFrom: true,
  });
  await createDriver(salesActor, { name: "Dana Ortiz", licenseNumber: "DEMO-DL-0001", phone: "505-555-0142" });
  await createVehicle(salesActor, { make: "Ford", model: "Transit Connect", plate: "DEMO-123" });

  // Retail: the storefront's menu, demo store rules, and two discounts.
  // The tax rates below are placeholders for the demo. A real store must enter its own.
  const shopManager = createdUsers.find((u) => u.role === "MANAGER")!;
  const shopActor: Actor = { userId: shopManager.id, userName: shopManager.name, orgId: org.id, facilityId: shop.id };
  await saveRetailSettings(shopActor, {
    flowerLimitGrams: "56.7",
    concentrateLimitGrams: "16",
    edibleLimitMg: "800",
    exciseTaxPercent: "12",
    salesTaxPercent: "7.5",
    medicalTaxExempt: true,
  });
  await setMenuItem(shopActor, { itemId: itemId["FLW-BM-35"], price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
  await setMenuItem(shopActor, { itemId: itemId["PR-DH-1"], price: "8", limitCategory: "FLOWER", limitPerUnit: "1" });
  await setMenuItem(shopActor, { itemId: itemId["EDI-PP-10"], price: "22", limitCategory: "EDIBLE", limitPerUnit: "100" });
  await createDiscount(shopActor, { name: "Veteran", percent: "10" });
  await createDiscount(shopActor, { name: "Staff", percent: "20" });

  // Both demo facilities are in practice mode, so the opening records show as sent.
  await processQueue({ facilityId: grow.id });
  await processQueue({ facilityId: shop.id });

  return { orgId: org.id, growId: grow.id, shopId: shop.id, users: createdUsers };
}
