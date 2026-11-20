import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, sales, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { addToCart, checkInCustomer, completeSale, openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `CD${Date.now().toString(36).toUpperCase()}`;
const adult = { birthDate: "1990-05-05", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" };
let actor: Actor;
let papers: string;

const newSale = async () => {
  const cart = await checkInCustomer(actor, adult);
  await addToCart(actor, { saleId: cart.id, itemId: papers, quantity: "5" });
  return cart.id;
};
const row = async (id: string) => (await db.select().from(sales).where(eq(sales.id, id)))[0];

describe.skipIf(!hasDb)("card payment details (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Card Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Card Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Bud Tender", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const [item] = await db.insert(items).values({ orgId: org.id, name: "Papers", sku: `${run}-P`, categoryId: category.id, unit: "EACH" }).returning();
    papers = item.id;
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    await setMenuItem(actor, { itemId: papers, price: "2", limitCategory: "NONE" });
    const pkg = await receiveRaw(actor, { tag: `${run}-1`, itemId: papers, quantity: "100", locationId: location.id });
    await addLabResult(actor, { packageId: pkg.id, labName: "Lab", status: "PASS", thcPercent: "0" });
    await openDrawer(actor, { openingCash: "100" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("saves the last 4 digits and approval number on a debit sale", async () => {
    const id = await newSale();
    await completeSale(actor, { saleId: id, paymentMethod: "DEBIT", cardLast4: "4242", cardRef: "AP-9981" });
    const s = await row(id);
    expect([s.cardLast4, s.cardRef]).toEqual(["4242", "AP-9981"]);
  });

  it("saves them on a split sale, and drops them from an all-cash sale", async () => {
    const split = await newSale();
    await completeSale(actor, { saleId: split, paymentMethod: "SPLIT", debitAmount: "5", cashTendered: "20", cardLast4: "1111" });
    expect((await row(split)).cardLast4).toBe("1111");
    const cash = await newSale();
    await completeSale(actor, { saleId: cash, paymentMethod: "CASH", cashTendered: "50", cardLast4: "2222", cardRef: "SHOULD-NOT-STICK" });
    const s = await row(cash);
    expect([s.cardLast4, s.cardRef]).toEqual([null, null]);
  });

  it("keeps the details optional, and refuses a long card number without finishing the sale", async () => {
    const id = await newSale();
    await expect(completeSale(actor, { saleId: id, paymentMethod: "DEBIT", cardLast4: "4111111111111111" })).rejects.toThrow(/last 4 digits/);
    expect((await row(id)).status).toBe("OPEN");
    await completeSale(actor, { saleId: id, paymentMethod: "DEBIT" });
    const s = await row(id);
    expect([s.status, s.cardLast4, s.cardRef]).toEqual(["COMPLETED", null, null]);
  });
});
