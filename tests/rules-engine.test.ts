import Decimal from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage, type Actor } from "@/lib/inventory";
import { addToCart, checkInCustomer, openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";
import { PACKS, combinedCap, effectiveLimits, minimumAge, packFor, requiresLabBeforeRetail } from "@/lib/rules";
import { scanFacility, scoreOf } from "@/lib/rules/scan";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `RUL${Date.now().toString(36).toUpperCase()}`;

describe("state rule packs", () => {
  it("every rule names its regulation, links to it, and says when it was checked", () => {
    for (const pack of Object.values(PACKS)) {
      const ids = new Set<string>();
      expect(pack.state).toMatch(/^[A-Z]{2}$/);
      for (const rule of pack.rules) {
        expect(ids.has(rule.id), rule.id).toBe(false);
        ids.add(rule.id);
        expect(rule.source.citation.length, rule.id).toBeGreaterThan(3);
        expect(rule.source.url, rule.id).toMatch(/^https:\/\//);
        expect(rule.source.checked, rule.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("uses the stricter of the store's and the state's numbers", () => {
    const nm = packFor("nm");
    const store = { FLOWER: new Decimal(100), CONCENTRATE: new Decimal(10), EDIBLE: new Decimal(800) };
    const { limits, fromState } = effectiveLimits(store, nm, "ADULT_USE");
    expect(limits.FLOWER.toNumber()).toBe(56.7);
    expect(limits.CONCENTRATE.toNumber()).toBe(10);
    expect([...fromState]).toEqual(["FLOWER"]);
    expect(effectiveLimits(store, null, "ADULT_USE").limits.FLOWER.toNumber()).toBe(100);
    expect(minimumAge(18, nm, "ADULT_USE")).toBe(21);
    expect(minimumAge(25, nm, "ADULT_USE")).toBe(25);
    expect(requiresLabBeforeRetail(nm)).toBe(true);
    expect(packFor("WY")).toBeNull();
  });

  it("has packs for New Mexico, California, Michigan, and Colorado with the confirmed numbers", () => {
    expect(Object.keys(PACKS).sort()).toEqual(["CA", "CO", "MI", "NM"]);
    const store = { FLOWER: new Decimal(1000), CONCENTRATE: new Decimal(1000), EDIBLE: new Decimal(100000) };
    const cap = (state: string, customer: "ADULT_USE" | "MEDICAL") => {
      const { limits } = effectiveLimits(store, packFor(state), customer);
      return [limits.FLOWER.toNumber(), limits.CONCENTRATE.toNumber(), limits.EDIBLE.toNumber()];
    };
    expect(cap("CA", "ADULT_USE")).toEqual([28.5, 8, 100000]);
    expect(cap("CA", "MEDICAL")).toEqual([226.8, 1000, 100000]);
    expect(cap("MI", "ADULT_USE")).toEqual([70.87, 15, 100000]);
    expect(combinedCap(packFor("MI"), "ADULT_USE")?.toNumber()).toBe(70.87);
    expect(combinedCap(packFor("CA"), "ADULT_USE")).toBeNull();
    expect(cap("CO", "ADULT_USE")).toEqual([28.35, 8, 100000]);
    expect(minimumAge(16, packFor("CA"), "MEDICAL")).toBe(18);
    expect(requiresLabBeforeRetail(packFor("CO"))).toBe(false);
  });

  it("scores issues", () => {
    expect(scoreOf([])).toBe(100);
    expect(scoreOf([{ id: "a", severity: "high", title: "", detail: "" }, { id: "b", severity: "medium", title: "", detail: "" }])).toBe(65);
    expect(scoreOf([{ id: "c", severity: "info", title: "", detail: "" }])).toBe(100);
  });
});

describe.skipIf(!hasDb)("state rules at the register and in the daily check (database)", () => {
  let actor: Actor;
  let jar: string;
  let shelf: string;
  const today = todayIn();
  const adult = { birthDate: "1990-01-01", idExpires: addDays(today, 365), customerType: "ADULT_USE" };

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Rules Org ${run}` }).returning();
    const [shop] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Lee", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [loc] = await db.insert(locations).values({ orgId: org.id, facilityId: shop.id, name: "Floor", type: "ROOM" }).returning();
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const [item] = await db.insert(items).values({ orgId: org.id, name: "Ounce Bag", sku: `${run}-OZ`, categoryId: cat.id, unit: "EACH" }).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: shop.id };
    jar = item.id;
    shelf = loc.id;
    // The store owner typed a flower limit above New Mexico's 2 oz.
    await saveRetailSettings(actor, { flowerLimitGrams: "200", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "7", medicalTaxExempt: true });
    await setMenuItem(actor, { itemId: jar, price: "150", limitCategory: "FLOWER", limitPerUnit: "28" });
    await openDrawer(actor, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("finds problems before an inspector does", async () => {
    await receivePackage(actor, { tag: `${run}-UNTESTED`, itemId: jar, quantity: "5", locationId: shelf });
    const scan = await scanFacility(actor.orgId, actor.facilityId);
    const ids = scan.issues.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["store-limits", "untested-menu", "reconciliation"]));
    expect(scan.issues.find((i) => i.id === "store-limits")?.detail).toMatch(/7\.05 oz \(state: 2 oz\)/);
    expect(scan.score).toBeLessThan(100);
  });

  it("will not sell untested product, and says why", async () => {
    const cart = await checkInCustomer(actor, adult);
    await expect(addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "1" })).rejects.toThrow(/Only 0 of Ounce Bag can be sold\. 5 more is waiting on a passing lab result, which New Mexico requires/);
  });

  it("applies New Mexico's 2 oz cap even though the store allows more", async () => {
    const tested = await receivePackage(actor, { tag: `${run}-TESTED`, itemId: jar, quantity: "5", locationId: shelf });
    await addLabResult(actor, { packageId: tested.id, labName: "Lab", status: "PASS", thcPercent: "21" });
    const cart = await checkInCustomer(actor, adult);
    await addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "2" });
    await expect(addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "1" })).rejects.toThrow(/New Mexico law allows 56\.7 g per purchase/);
  });

  it("counts flower and concentrate together where Michigan requires it", async () => {
    const [mi] = await db.insert(facilities).values({ orgId: actor.orgId, name: "Detroit", licenseNumber: `${run}-MI`, licenseType: "RETAIL", state: "MI" }).returning();
    const miActor = { ...actor, facilityId: mi.id };
    const [floor] = await db.insert(locations).values({ orgId: actor.orgId, facilityId: mi.id, name: "Floor", type: "ROOM" }).returning();
    const [cat] = await db.insert(itemCategories).values({ orgId: actor.orgId, name: `MI ${run}` }).returning();
    const [flower, wax] = await db
      .insert(items)
      .values([
        { orgId: actor.orgId, name: "Big Bag", sku: `${run}-BB`, categoryId: cat.id, unit: "EACH" as const },
        { orgId: actor.orgId, name: "Wax", sku: `${run}-WX`, categoryId: cat.id, unit: "EACH" as const },
      ])
      .returning();
    await saveRetailSettings(miActor, { flowerLimitGrams: "500", concentrateLimitGrams: "500", edibleLimitMg: "5000", exciseTaxPercent: "10", salesTaxPercent: "6", medicalTaxExempt: true });
    await setMenuItem(miActor, { itemId: flower.id, price: "200", limitCategory: "FLOWER", limitPerUnit: "30" });
    await setMenuItem(miActor, { itemId: wax.id, price: "40", limitCategory: "CONCENTRATE", limitPerUnit: "14" });
    for (const [itemId, tag] of [
      [flower.id, `${run}-MIF`],
      [wax.id, `${run}-MIW`],
    ]) {
      const pkg = await receivePackage(miActor, { tag, itemId, quantity: "10", locationId: floor.id });
      await addLabResult(miActor, { packageId: pkg.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    }
    await openDrawer(miActor, { openingCash: "0" });
    const cart = await checkInCustomer(miActor, adult);
    await addToCart(miActor, { saleId: cart.id, itemId: flower.id, quantity: "2" });
    await expect(addToCart(miActor, { saleId: cart.id, itemId: wax.id, quantity: "1" })).rejects.toThrow(/74 g of flower and concentrate together\. Michigan law allows 70\.87 g/);
  });

  it("says plainly when a state has no rule pack", async () => {
    const [wy] = await db.insert(facilities).values({ orgId: actor.orgId, name: "Elsewhere", licenseNumber: `${run}-W`, licenseType: "RETAIL", state: "WY" }).returning();
    const scan = await scanFacility(actor.orgId, wy.id);
    expect(scan.pack).toBeNull();
    expect(scan.issues[0]).toMatchObject({ id: "no-pack", severity: "info" });
  });
});
