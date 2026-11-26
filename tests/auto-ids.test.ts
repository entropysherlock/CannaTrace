import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packages, plants, users } from "@/db/schema";
import { createPlantBatch, createStrain, tagPlants } from "@/lib/cultivation";
import { db, pool } from "@/lib/db";
import { generateTags, skuPrefix } from "@/lib/ids";
import { importCsv } from "@/lib/importer";
import { mergePackages, receivePackage, splitPackage, type Actor } from "@/lib/inventory";
import { renameItem } from "@/lib/item-details";
import { starterTemplates } from "@/lib/labels/defaults";
import { loadLabelRecords } from "@/lib/labels/data";
import { validateLabels } from "@/lib/labels/validate";
import { quickAddItem } from "@/lib/quick-item";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `ID${Date.now().toString(36).toUpperCase()}`;

describe("generated SKU prefixes", () => {
  it("uses the first letters of the category", () => {
    expect(skuPrefix("Flower")).toBe("FLO");
    expect(skuPrefix("Pre-rolls")).toBe("PRE");
    expect(skuPrefix("42")).toBe("ITM");
  });
});

describe.skipIf(!hasDb)("generated plant tags, package tags, and SKUs (database)", () => {
  let actor: Actor;
  let room: string;
  let flowerItem: string;
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Auto IDs ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Grow", licenseNumber: run, licenseType: "MICROBUSINESS", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Carly", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    [{ id: room }] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Vault", type: "ROOM" }).returning();
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    [{ id: flowerItem }] = await db.insert(items).values({ orgId: org.id, name: "Bulk flower", sku: "MY-OWN-SKU", categoryId: cat.id, unit: "G" }).returning();
    actor = { orgId: org.id, facilityId: facility.id, userId: user.id, userName: user.name };
  });
  afterAll(() => pool.end());

  it("receives a package with no tag and gives it the next unique ID, skipping one typed by hand", async () => {
    await receivePackage(actor, { tag: "PKG-000002", itemId: flowerItem, quantity: "10", locationId: room });
    const a = await receivePackage(actor, { tag: "", itemId: flowerItem, quantity: "100", locationId: room });
    const b = await receivePackage(actor, { tag: "  ", itemId: flowerItem, quantity: "100", locationId: room });
    expect(a.tag).toBe("PKG-000001");
    expect(b.tag).toBe("PKG-000003"); // 000002 was already taken
    // A scanned state tag is still used as is
    const c = await receivePackage(actor, { tag: "1a4000000000000000012345", itemId: flowerItem, quantity: "5", locationId: room });
    expect(c.tag).toBe("1A4000000000000000012345");
  });

  it("never hands out the same ID twice, even when many are asked for at once", async () => {
    const lots = await Promise.all([1, 2, 3, 4].map(() => db.transaction((tx) => generateTags(tx, actor.orgId, "PACKAGE", 25))));
    const all = lots.flat();
    expect(new Set(all).size).toBe(100);
  });

  it("generates tags when splitting and merging", async () => {
    const source = await receivePackage(actor, { tag: "", itemId: flowerItem, quantity: "50", locationId: room });
    const { children } = await splitPackage(actor, { packageId: source.id, parts: [{ tag: "", quantity: "10" }, { tag: `${run}-S2`, quantity: "10" }, { quantity: "10" }] });
    expect(children.map((c) => c.tag)).toEqual([expect.stringMatching(/^PKG-\d{6}$/), `${run}-S2`, expect.stringMatching(/^PKG-\d{6}$/)]);
    const merged = await mergePackages(actor, { sourceIds: [children[0].id, children[2].id] });
    expect(merged.tag).toMatch(/^PKG-\d{6}$/);
  });

  it("tags a batch of plants with generated IDs", async () => {
    const strain = await createStrain(actor, { name: `Strain ${run}`, type: "HYBRID" });
    const batch = await createPlantBatch(actor, { name: `${run}-B`, strainId: strain.id, source: "CLONE", count: "12", locationId: room });
    const tagged = await tagPlants(actor, { batchId: batch.id, generate: 10 });
    expect(tagged.map((p) => p.tag).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `PLT-${String(i + 1).padStart(6, "0")}`));
    await expect(tagPlants(actor, { batchId: batch.id, generate: 5 })).rejects.toThrow(/2 untagged plants left/);
    expect(await db.$count(plants, eq(plants.batchId, batch.id))).toBe(10);
  });

  it("generates SKUs from the category, and lets them be changed (still unique)", async () => {
    const a = await quickAddItem(actor, { name: "Gummies", unit: "EACH", category: "Edibles" });
    const b = await quickAddItem(actor, { name: "Chews", unit: "EACH", category: "Edibles" });
    const skus = await db.select({ id: items.id, sku: items.sku }).from(items).where(eq(items.orgId, actor.orgId));
    const sku = (id: string) => skus.find((s) => s.id === id)!.sku;
    expect([sku(a.id), sku(b.id)]).toEqual(["EDI-0001", "EDI-0002"]);
    await expect(renameItem(actor, b.id, { name: "Chews", sku: "edi-0001" })).rejects.toThrow(/already used/);
    expect(await renameItem(actor, b.id, { name: "Fruit Chews", sku: "chew-10" })).toMatchObject({ name: "Fruit Chews", sku: "CHEW-10", changed: true });
    await expect(renameItem(actor, b.id, { name: "Fruit Chews", sku: "no spaces" })).rejects.toThrow(/valid SKU/);
  });

  it("imports items without SKUs and opening inventory without tags", async () => {
    await importCsv(actor, "items", "name,category,unit\nTincture 30ml,Tinctures,EACH\nBalm,Topicals,EACH");
    const [t] = await db.select().from(items).where(and(eq(items.orgId, actor.orgId), eq(items.name, "Tincture 30ml")));
    expect(t.sku).toBe("TIN-0001");
    await importCsv(actor, "packages", "sku,quantity,location\nTIN-0001,24,Vault");
    const [p] = await db.select().from(packages).where(and(eq(packages.orgId, actor.orgId), eq(packages.itemId, t.id)));
    expect(p.tag).toMatch(/^PKG-\d{6}$/);
  });

  it("never allows two items with the same name: rename and CSV import both refuse", async () => {
    const a = await quickAddItem(actor, { name: "Dupe Guard Gummies", unit: "EACH", category: "Edibles" });
    const b = await quickAddItem(actor, { name: "Dupe Guard Chews", unit: "EACH", category: "Edibles" });
    // Capitals and spaces do not make a different name.
    await expect(renameItem(actor, b.id, { name: "dupe  guard gummies", sku: (await db.select({ sku: items.sku }).from(items).where(eq(items.id, b.id)))[0].sku })).rejects.toThrow(/already have an item called Dupe Guard Gummies/);
    await expect(importCsv(actor, "items", "name,category,unit\nDUPE GUARD GUMMIES,Edibles,EACH")).rejects.toThrow(/already have an item called Dupe Guard Gummies/);
    await expect(importCsv(actor, "items", "name,category,unit\nNew Twin,Edibles,EACH\nnew twin,Edibles,EACH")).rejects.toThrow(/appears more than once/);
    expect(await db.$count(items, and(eq(items.orgId, actor.orgId), eq(items.name, "New Twin")))).toBe(0);
    expect(a.id).not.toBe(b.id);
  });

  it("prints generated tags as scannable barcodes on every starter label", async () => {
    const pkg = await receivePackage(actor, { tag: "", itemId: flowerItem, quantity: "28", locationId: room });
    const records = await loadLabelRecords(actor, "PACKAGE", [pkg.id]);
    for (const t of starterTemplates("NM").filter((s) => s.kind === "PACKAGE" || s.kind === "PRODUCT")) {
      const barcodeIssues = validateLabels(t.design, "PACKAGE", null, records).issues.filter((i) => i.category === "BARCODE");
      expect(barcodeIssues).toEqual([]);
    }
  });
});
