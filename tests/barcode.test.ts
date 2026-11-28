import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { retailPrices, facilities, itemCategories, items, locations, organizations, users } from "@/db/schema";
import { barcodeKey, cleanBarcode } from "@/lib/barcode";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { renameItem } from "@/lib/item-details";
import { addSellableToMenu } from "@/lib/menu-bulk";
import { isPriced } from "@/lib/menu-price";
import { quickAddItem } from "@/lib/quick-item";
import { addScannedCode, cartLines, checkInCustomer, openDrawer, saveRetailSettings, removeMenuItem, setMenuItem } from "@/lib/pos";

const fail = (m: string): never => {
  throw new Error(m);
};

describe("barcode cleanup", () => {
  it("drops spaces, capitalizes, and treats blank as none", () => {
    expect(cleanBarcode(" 0 12345 67890 5 ", fail)).toBe("012345678905");
    expect(cleanBarcode("abc-123", fail)).toBe("ABC-123");
    expect(cleanBarcode("", fail)).toBeNull();
    expect(cleanBarcode(undefined, fail)).toBeNull();
  });
  it("rejects things that can't be a barcode", () => {
    expect(() => cleanBarcode("12", fail)).toThrow(/isn't a barcode/);
    expect(() => cleanBarcode("hello!!world", fail)).toThrow(/isn't a barcode/);
    expect(() => cleanBarcode("0000", fail)).toThrow(/all zeros/);
  });
  it("sees a UPC-A and the same code as an EAN-13 as one barcode", () => {
    expect(barcodeKey("012345678905")).toBe(barcodeKey("0012345678905"));
    expect(barcodeKey("012345678905")).not.toBe(barcodeKey("012345678906"));
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `BC${Date.now().toString(36).toUpperCase()}`;
const adult = { birthDate: "1990-05-05", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" };

describe.skipIf(!hasDb)("scanning a product barcode at the register (database)", () => {
  let actor: Actor;
  let jarId: string;
  let vapeId: string;
  let n = 0;
  const tag = () => `${run}-${String(++n).padStart(4, "0")}`;
  const cartNames = async (saleId: string) => (await cartLines(db, saleId)).map((l) => `${l.itemName}x${Number(l.quantity)}`);

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Barcode Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Manager", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const [jar, vape] = await db.insert(items).values([
      { orgId: org.id, name: "Jar 3.5", sku: `${run}J`, categoryId: category.id, unit: "EACH" as const },
      { orgId: org.id, name: "Vape", sku: `${run}V`, categoryId: category.id, unit: "EACH" as const },
    ]).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    jarId = jar.id;
    vapeId = vape.id;
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "8", medicalTaxExempt: true });
    for (const id of [jarId, vapeId]) {
      await setMenuItem(actor, { itemId: id, price: "40", limitCategory: "NONE" });
      const pkg = await receiveRaw(actor, { tag: tag(), itemId: id, quantity: "50", locationId: location.id });
      await addLabResult(actor, { packageId: pkg.id, labName: "Test Lab", status: "PASS", thcPercent: "20" });
    }
    await openDrawer(actor, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("does not ring up an unknown barcode, and says how to fix it", async () => {
    const sale = await checkInCustomer(actor, adult);
    await expect(addScannedCode(actor, { saleId: sale.id, code: "012345678905" })).rejects.toThrow(/Add or change a menu item/);
  });

  it("saves a barcode from the menu form, then rings the item up when it's scanned", async () => {
    await setMenuItem(actor, { itemId: jarId, price: "40", limitCategory: "KEEP", barcode: " 0 12345 67890 5 " });
    const [item] = await db.select({ barcode: items.barcode }).from(items).where(eq(items.id, jarId));
    expect(item.barcode).toBe("012345678905");
    const sale = await checkInCustomer(actor, adult);
    expect((await addScannedCode(actor, { saleId: sale.id, code: "012345678905" })).itemName).toBe("Jar 3.5");
    // The same code read as an EAN-13 (one leading zero more) is the same product, and counts up.
    await addScannedCode(actor, { saleId: sale.id, code: "0012345678905" });
    expect(await cartNames(sale.id)).toEqual(["Jar 3.5x2"]);
  });

  it("leaves the barcode alone when the menu form's barcode box is blank", async () => {
    await setMenuItem(actor, { itemId: jarId, price: "41", limitCategory: "KEEP", barcode: "" });
    const [item] = await db.select({ barcode: items.barcode }).from(items).where(eq(items.id, jarId));
    expect(item.barcode).toBe("012345678905");
  });

  it("won't give two items the same barcode, even with leading zeros", async () => {
    await expect(setMenuItem(actor, { itemId: vapeId, price: "40", limitCategory: "KEEP", barcode: "12345678905" })).rejects.toThrow(/already belongs to Jar 3\.5/);
    await expect(renameItem(actor, vapeId, { name: "Vape", sku: `${run}V`, barcode: "0012345678905" })).rejects.toThrow(/already belongs/);
  });

  it("can set, change and clear a barcode from the item page, and add one with a new item", async () => {
    await renameItem(actor, vapeId, { name: "Vape", sku: `${run}V`, barcode: "999000111222" });
    const sale = await checkInCustomer(actor, adult);
    expect((await addScannedCode(actor, { saleId: sale.id, code: "999000111222" })).itemName).toBe("Vape");
    // Leaving the barcode out of the call changes nothing; a blank clears it.
    await renameItem(actor, vapeId, { name: "Vape 2", sku: `${run}V` });
    expect((await db.select({ b: items.barcode }).from(items).where(eq(items.id, vapeId)))[0].b).toBe("999000111222");
    await renameItem(actor, vapeId, { name: "Vape 2", sku: `${run}V`, barcode: "" });
    await expect(addScannedCode(actor, { saleId: sale.id, code: "999000111222" })).rejects.toThrow(/Nothing at this store matches/);
    const added = await quickAddItem(actor, { name: "Gummies", unit: "EACH", category: "Edibles", barcode: "777888999000" });
    const [row] = await db.select({ barcode: items.barcode }).from(items).where(and(eq(items.id, added.id), eq(items.orgId, actor.orgId)));
    expect(row.barcode).toBe("777888999000");
    await expect(quickAddItem(actor, { name: "Gummies 2", unit: "EACH", category: "Edibles", barcode: "777888999000" })).rejects.toThrow(/already belongs to Gummies/);
  });

  it("still finds an item by SKU and by package tag", async () => {
    const sale = await checkInCustomer(actor, adult);
    expect((await addScannedCode(actor, { saleId: sale.id, code: `${run}J`.toLowerCase() })).itemName).toBe("Jar 3.5");
  });

  it("takes an item off the menu without touching the item, and it can be added back", async () => {
    await removeMenuItem(actor, { itemId: vapeId });
    await expect(removeMenuItem(actor, { itemId: vapeId })).rejects.toThrow(/not on the menu/);
    const [still] = await db.select({ id: items.id }).from(items).where(eq(items.id, vapeId));
    expect(still.id).toBe(vapeId);
    await setMenuItem(actor, { itemId: vapeId, price: "40", limitCategory: "KEEP" });
  });

  it("adds only items that have sellable stock to the menu, once", async () => {
    const [loc] = await db.select({ id: locations.id }).from(locations).where(eq(locations.orgId, actor.orgId));
    const [cat] = await db.select({ id: itemCategories.id }).from(itemCategories).where(eq(itemCategories.orgId, actor.orgId));
    const [withStock, noStock] = await db
      .insert(items)
      .values([
        { orgId: actor.orgId, name: "Stocked Newcomer", sku: `${run}N1`, categoryId: cat.id, unit: "EACH" as const },
        { orgId: actor.orgId, name: "Empty Newcomer", sku: `${run}N2`, categoryId: cat.id, unit: "EACH" as const },
      ])
      .returning();
    const pkg = await receiveRaw(actor, { tag: tag(), itemId: withStock.id, quantity: "9", locationId: loc.id });
    await addLabResult(actor, { packageId: pkg.id, labName: "Test Lab", status: "PASS", thcPercent: "20" });
    const first = await addSellableToMenu(actor);
    expect(first.added).toEqual(["Stocked Newcomer"]);
    const onMenu = (await db.select({ id: retailPrices.itemId }).from(retailPrices).where(eq(retailPrices.facilityId, actor.facilityId))).map((r) => r.id);
    expect(onMenu).toContain(withStock.id);
    expect(onMenu).not.toContain(noStock.id);
    const [row] = await db.select({ price: retailPrices.price }).from(retailPrices).where(and(eq(retailPrices.facilityId, actor.facilityId), eq(retailPrices.itemId, withStock.id)));
    expect(isPriced(row.price)).toBe(false);
    expect((await addSellableToMenu(actor)).added).toEqual([]);
  });
});

describe("menu items waiting for a price", () => {
  it("counts only a price above zero as a real shelf price", () => {
    expect(isPriced("0")).toBe(false);
    expect(isPriced("0.0000")).toBe(false);
    expect(isPriced(null)).toBe(false);
    expect(isPriced("0.01")).toBe(true);
    expect(isPriced("20")).toBe(true);
  });
});
