import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packages, reservations, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import {
  cleanPhone,
  createReservation,
  normalizeSlug,
  pickupQueue,
  publicMenu,
  publicReservation,
  saveMenuSettings,
  setReservationStatus,
  startSaleFromReservation,
  waitingCount,
} from "@/lib/online-menu";
import { cartLines, openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `OM${Date.now().toString(36).toUpperCase()}`;
const slug = `shop-${run.toLowerCase()}`;
const today = todayIn();
const adult = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };
let n = 0;
let phoneN = 5055550100;
const phone = () => String(phoneN++);
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

let actor: Actor;
let blossom: string;
let sold: string;
let hidden: string;
let shelf: string;

async function receive(itemId: string, quantity: string) {
  const pkg = await receiveRaw(actor, { tag: tag(), itemId, quantity, locationId: shelf });
  await addLabResult(actor, { packageId: pkg.id, labName: "Lab", status: "PASS", thcPercent: "20" });
  return pkg;
}
const reserve = (lines: { itemId: string; quantity: string }[], extra: Partial<Parameters<typeof createReservation>[1]> = {}) =>
  createReservation(slug, { name: "Pat Visitor", phone: phone(), adult: true, lines, ...extra });

describe("web address and phone cleaning", () => {
  it("tidies addresses and phone numbers", () => {
    expect(normalizeSlug("  Sandia Storefront!! ")).toBe("sandia-storefront");
    expect(normalizeSlug("a__b  c")).toBe("a-b-c");
    expect(cleanPhone("(505) 555-0142")).toBe("5055550142");
    expect(cleanPhone("+1 505 555 0142")).toBe("5055550142");
    expect(() => cleanPhone("555-0142")).toThrow(/10-digit/);
  });
});

describe.skipIf(!hasDb)("online menu and pickup reservations (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Menu Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Menu Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Bud Tender", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const made = await db
      .insert(items)
      .values(["Blossom 3.5", "Sold Out Jar", "Not On Menu"].map((name, i) => ({ orgId: org.id, name, sku: `${run}-${i}`, categoryId: category.id, unit: "EACH" as const })))
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    shelf = location.id;
    [blossom, sold, hidden] = made.map((i) => i.id);
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    await setMenuItem(actor, { itemId: blossom, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await setMenuItem(actor, { itemId: sold, price: "30", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await receive(blossom, "10");
    await openDrawer(actor, { openingCash: "100" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("stays off until a manager turns it on, and needs store rules first", async () => {
    expect(await publicMenu(slug)).toBeNull();
    await expect(saveMenuSettings(actor, { enabled: true, slug: "x", takeReservations: true })).rejects.toThrow(/3 to 40/);
    await expect(saveMenuSettings(actor, { enabled: true, slug: "login", takeReservations: true })).rejects.toThrow(/reserved/);
    const [bare] = await db.insert(facilities).values({ orgId: actor.orgId, name: "No Rules", licenseNumber: `${run}-B`, licenseType: "RETAIL", state: "NM" }).returning();
    await expect(saveMenuSettings({ ...actor, facilityId: bare.id }, { enabled: true, slug: `${slug}-b`, takeReservations: true })).rejects.toThrow(/purchase limits and tax rates first/);
    await saveMenuSettings(actor, { enabled: true, slug: slug.toUpperCase(), takeReservations: true, welcome: "Hello!", pickupNote: "Park in back." });
    await expect(saveMenuSettings({ ...actor, facilityId: bare.id }, { enabled: false, slug, takeReservations: true })).rejects.toThrow(/already uses that address/);
  });

  it("shows only what the register could sell, at shelf prices, with no stock counts", async () => {
    const menu = await publicMenu(slug);
    expect(menu?.storeName).toBe("Menu Shop");
    const all = menu!.categories.flatMap((c) => c.items);
    expect(all.map((i) => i.name)).toEqual(["Blossom 3.5"]); // sold-out and off-menu items are left out
    expect(all[0].price).toBe("35.00");
    expect(JSON.stringify(menu)).not.toMatch(/"(quantity|stock|tag|cost)/i);
    // A failed lab result takes it off the public menu, same as the register.
    const bad = await receive(blossom, "5");
    await addLabResult(actor, { packageId: bad.id, labName: "Lab", status: "FAIL", thcPercent: "20" });
    const still = (await publicMenu(slug))!.categories.flatMap((c) => c.items);
    expect(still).toHaveLength(1);
  });

  it("takes a reservation without touching stock, and checks the visitor's details", async () => {
    const before = (await db.select().from(packages).where(eq(packages.itemId, blossom))).reduce((s, p) => s + Number(p.quantity), 0);
    const r = await reserve([{ itemId: blossom, quantity: "2" }], { note: "Ring the bell" });
    expect(r.number).toMatch(/^PU-\d{5}$/);
    const after = (await db.select().from(packages).where(eq(packages.itemId, blossom))).reduce((s, p) => s + Number(p.quantity), 0);
    expect(after).toBe(before);
    const mine = await publicReservation(slug, r.id);
    expect(mine?.firstName).toBe("Pat");
    expect(mine?.lines[0].name).toBe("Blossom 3.5");
    expect(await publicReservation(slug, "not-a-real-id")).toBeNull();

    await expect(reserve([{ itemId: blossom, quantity: "1" }], { adult: false })).rejects.toThrow(/21 or older/);
    await expect(reserve([{ itemId: blossom, quantity: "1" }], { name: "  " })).rejects.toThrow(/Enter your name/);
    await expect(reserve([{ itemId: blossom, quantity: "1" }], { phone: "123" })).rejects.toThrow(/10-digit/);
    await expect(reserve([])).rejects.toThrow(/at least one/);
    await expect(reserve([{ itemId: blossom, quantity: "0" }])).rejects.toThrow(/greater than zero/);
    await expect(reserve([{ itemId: blossom, quantity: "1.5" }])).rejects.toThrow(/whole number/);
    await expect(reserve([{ itemId: blossom, quantity: "11" }])).rejects.toThrow(/not enough Blossom/);
    await expect(reserve([{ itemId: sold, quantity: "1" }])).rejects.toThrow(/sold out/);
    await expect(reserve([{ itemId: hidden, quantity: "1" }])).rejects.toThrow(/no longer on the menu/);
  });

  it("ignores robots, and limits open reservations per phone number", async () => {
    const quiet = await reserve([{ itemId: blossom, quantity: "1" }], { website: "http://spam.example" });
    expect(quiet.id).toBe("ignored");
    expect(await db.select().from(reservations).where(eq(reservations.id, "ignored"))).toHaveLength(0);
    const same = phone();
    for (let i = 0; i < 3; i++) await createReservation(slug, { name: "Repeat", phone: same, adult: true, lines: [{ itemId: blossom, quantity: "1" }] });
    await expect(createReservation(slug, { name: "Repeat", phone: same, adult: true, lines: [{ itemId: blossom, quantity: "1" }] })).rejects.toThrow(/already have open reservations/);
  });

  it("refuses reservations when the store turns them off, or the menu off", async () => {
    await saveMenuSettings(actor, { enabled: true, slug, takeReservations: false });
    await expect(reserve([{ itemId: blossom, quantity: "1" }])).rejects.toThrow(/not taking online reservations/);
    await saveMenuSettings(actor, { enabled: false, slug, takeReservations: true });
    expect(await publicMenu(slug)).toBeNull();
    await expect(reserve([{ itemId: blossom, quantity: "1" }])).rejects.toThrow(/not taking online reservations/);
    await saveMenuSettings(actor, { enabled: true, slug, takeReservations: true });
  });

  it("shows staff the queue, and lets them mark ready or cancel", async () => {
    const r = await reserve([{ itemId: blossom, quantity: "1" }]);
    const queue = await pickupQueue(actor);
    const row = queue.find((q) => q.id === r.id)!;
    expect(row.status).toBe("NEW");
    expect(row.lines[0].inStock).toBe("10");
    const waiting = await waitingCount(actor.facilityId);
    await setReservationStatus(actor, { id: r.id, status: "READY" });
    expect((await pickupQueue(actor)).find((q) => q.id === r.id)!.status).toBe("READY");
    expect(await waitingCount(actor.facilityId)).toBe(waiting);
    await setReservationStatus(actor, { id: r.id, status: "CANCELLED", reason: "No show" });
    expect(await waitingCount(actor.facilityId)).toBe(waiting - 1);
    await expect(setReservationStatus(actor, { id: r.id, status: "READY" })).rejects.toThrow(/was cancelled/);
    await expect(setReservationStatus(actor, { id: r.id, status: "BOGUS" })).rejects.toThrow(/Choose/);
    // Another store's staff cannot touch it.
    const [elsewhere] = await db.insert(facilities).values({ orgId: actor.orgId, name: "Elsewhere", licenseNumber: `${run}-Z`, licenseType: "RETAIL", state: "NM" }).returning();
    const r2 = await reserve([{ itemId: blossom, quantity: "1" }]);
    await expect(setReservationStatus({ ...actor, facilityId: elsewhere.id }, { id: r2.id, status: "READY" })).rejects.toThrow(/not found at this store/);
  });

  it("opens a cart from a reservation after the ID check, leaving out what cannot be sold", async () => {
    const r = await reserve([{ itemId: blossom, quantity: "3" }]);
    // Underage or expired ID: nothing is opened and the reservation stays waiting.
    await expect(startSaleFromReservation(actor, { id: r.id, ...adult, birthDate: addDays(today, -365) })).rejects.toThrow(/minimum age/);
    expect((await pickupQueue(actor)).find((q) => q.id === r.id)!.status).toBe("NEW");
    const started = await startSaleFromReservation(actor, { id: r.id, ...adult });
    expect(started.left).toEqual([]);
    const lines = await cartLines(db, started.saleId);
    expect(lines.map((l) => [l.itemName, Number(l.quantity)])).toEqual([["Blossom 3.5", 3]]);
    expect((await pickupQueue(actor)).find((q) => q.id === r.id)!.status).toBe("IN_SALE");
    await expect(startSaleFromReservation(actor, { id: r.id, ...adult })).rejects.toThrow(/already open/);
    expect((await publicReservation(slug, r.id))?.status).toBe("IN_SALE");

    // Stock sold since the reservation: that line is left out and explained; the rest still goes in.
    await receive(sold, "2");
    const mixed = await reserve([{ itemId: blossom, quantity: "1" }, { itemId: sold, quantity: "2" }]);
    await db.execute(sql`update packages set quantity = 0 where item_id = ${sold} and org_id = ${actor.orgId}`);
    const second = await startSaleFromReservation(actor, { id: mixed.id, ...adult });
    expect(second.left).toHaveLength(1);
    expect(second.left[0]).toMatch(/Sold Out Jar/);
    expect((await cartLines(db, second.saleId)).map((l) => l.itemName)).toEqual(["Blossom 3.5"]);
  });
});
