import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { facilities, itemCategories, items, locations, organizations, packages, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { adjustPackage, movePackage, receivePackage, type Actor } from "@/lib/inventory";

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
    [grow.id, ["Vault A", "Vault A / Rack 1", "Vault A / Rack 2", "Dry Room", "Packaging Line", "Quarantine Cage"]],
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
    .values(["Flower", "Pre-rolls", "Concentrates", "Edibles", "Trim"].map((name) => ({ orgId: org.id, name })))
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
    [shop.id, "CT-000101", "FLW-BM-35", "96", "Back Stock", "LOT-BM-1101"],
    [shop.id, "CT-000102", "PR-DH-1", "200", "Sales Floor", "LOT-DH-1102"],
    [shop.id, "CT-000103", "EDI-PP-10", "60", "Sales Floor", "LOT-PP-1030"],
  ] as const;
  const packageId: Record<string, string> = {};
  for (const [facilityId, tag, sku, quantity, location, lotNumber] of receipts) {
    const pkg = await receivePackage(actor(facilityId), {
      tag,
      itemId: itemId[sku],
      quantity,
      locationId: locationId[`${facilityId}:${location}`],
      lotNumber,
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

  console.log(`Seeded "${org.name}". Sign in as owner@demo.test / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
