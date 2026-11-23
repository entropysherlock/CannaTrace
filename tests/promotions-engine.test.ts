import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  facilities,
  itemCategories,
  items,
  locations,
  organizations,
  promotions,
  sales,
  users,
} from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import {
  addLabResult,
  receivePackage as receiveRaw,
  type Actor,
} from "@/lib/inventory";
import {
  addToCart,
  checkInCustomer,
  completeSale,
  openDrawer,
  saveRetailSettings,
  setMenuItem,
  voidSale,
} from "@/lib/pos";
import {
  cartPromos,
  createPromotion,
  deletePromotion,
  setPromotionActive,
} from "@/lib/promotions";
import { storeClock } from "@/lib/promotions";

/** Automatic promotions through the real register: applied at checkout, kept on the sale, never free. */
const hasDb = Boolean(process.env.DATABASE_URL);
const run = `PM${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
const adult = {
  birthDate: "1990-05-05",
  idExpires: addDays(today, 400),
  customerType: "ADULT_USE",
};

let actor: Actor;
let jar: string;
let papers: string;
let categoryId: string;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

async function cart(wanted: [string, string][]) {
  const s = await checkInCustomer(actor, adult);
  for (const [itemId, quantity] of wanted)
    await addToCart(actor, { saleId: s.id, itemId, quantity });
  return s.id;
}

describe.skipIf(!hasDb)("promotions (database)", () => {
  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: `Promo Org ${run}` })
      .returning();
    const [facility] = await db
      .insert(facilities)
      .values({
        orgId: org.id,
        name: "Shop",
        licenseNumber: `${run}-A`,
        licenseType: "RETAIL",
        state: "NM",
      })
      .returning();
    const [user] = await db
      .insert(users)
      .values({
        orgId: org.id,
        name: "Bud Tender",
        email: `${run.toLowerCase()}@test.invalid`,
        passwordHash: "x",
        role: "MANAGER",
      })
      .returning();
    const [location] = await db
      .insert(locations)
      .values({
        orgId: org.id,
        facilityId: facility.id,
        name: "Floor",
        type: "ROOM",
      })
      .returning();
    const [category] = await db
      .insert(itemCategories)
      .values({ orgId: org.id, name: "All" })
      .returning();
    categoryId = category.id;
    const made = await db
      .insert(items)
      .values(
        ["Jar 3.5", "Papers"].map((name, i) => ({
          orgId: org.id,
          name,
          sku: `${run}${i}`,
          categoryId: category.id,
          unit: "EACH" as const,
        })),
      )
      .returning();
    actor = {
      userId: user.id,
      userName: user.name,
      orgId: org.id,
      facilityId: facility.id,
    };
    [jar, papers] = made.map((i) => i.id);
    await saveRetailSettings(actor, {
      flowerLimitGrams: "56.7",
      concentrateLimitGrams: "16",
      edibleLimitMg: "800",
      exciseTaxPercent: "12",
      salesTaxPercent: "8",
      medicalTaxExempt: true,
    });
    await setMenuItem(actor, {
      itemId: jar,
      price: "40",
      limitCategory: "FLOWER",
      limitPerUnit: "3.5",
    });
    await setMenuItem(actor, {
      itemId: papers,
      price: "2",
      limitCategory: "NONE",
    });
    for (const itemId of [jar, papers]) {
      const pkg = await receiveRaw(actor, {
        tag: tag(),
        itemId,
        quantity: "100",
        locationId: location.id,
      });
      await addLabResult(actor, {
        packageId: pkg.id,
        labName: "Test Lab",
        status: "PASS",
        thcPercent: "20",
      });
    }
    await openDrawer(actor, { openingCash: "100" });
  });
  afterAll(() => pool.end());

  it("refuses a promotion that would give product away, or that is half filled in", async () => {
    await expect(
      createPromotion(
        actor,
        { name: "Free", kind: "PERCENT", amount: "100", scope: "ALL" },
        [],
      ),
    ).rejects.toThrow(/at most 90%/);
    await expect(
      createPromotion(
        actor,
        { name: "", kind: "PERCENT", amount: "10", scope: "ALL" },
        [],
      ),
    ).rejects.toThrow(/name/);
    await expect(
      createPromotion(
        actor,
        { name: "X", kind: "PERCENT", amount: "10", scope: "CATEGORY" },
        [],
      ),
    ).rejects.toThrow(/category/);
    await expect(
      createPromotion(
        actor,
        {
          name: "X",
          kind: "PERCENT",
          amount: "10",
          scope: "ALL",
          startTime: "25:00",
        },
        [],
      ),
    ).rejects.toThrow(/Start time/);
    await expect(
      createPromotion(
        actor,
        {
          name: "X",
          kind: "PERCENT",
          amount: "10",
          scope: "CATEGORY",
          categoryId: "someone-elses",
        },
        [],
      ),
    ).rejects.toThrow(/isn't on your menu/);
  });

  it("takes a promotion off at checkout, keeps it on the sale, and a void keeps the record", async () => {
    const promo = await createPromotion(
      actor,
      {
        name: "Jar Day",
        kind: "PERCENT",
        amount: "25",
        scope: "ITEM",
        itemId: jar,
      },
      [],
    );
    const s = await cart([
      [jar, "1"],
      [papers, "1"],
    ]);
    const lines = await db.query.saleLines.findMany({
      where: (t, { eq: e }) => e(t.saleId, s),
    });
    const live = await cartPromos(
      db,
      actor,
      lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    );
    expect(live.total.toFixed(2)).toBe("10.00");
    await completeSale(actor, { saleId: s, paymentMethod: "DEBIT" });
    const [done] = await db.select().from(sales).where(eq(sales.id, s));
    // $42 less $10 = $32; 12% excise 3.84 + 8% sales tax 2.56.
    expect(done).toMatchObject({
      subtotal: "42.00",
      promoDiscount: "10.00",
      promoNames: "Jar Day",
      discountTotal: "10.00",
      exciseTax: "3.84",
      salesTax: "2.56",
      total: "38.40",
    });
    await voidSale(actor, { saleId: s, reason: "test" });
    expect(
      (await db.select().from(sales).where(eq(sales.id, s)))[0].promoDiscount,
    ).toBe("10.00");
    await deletePromotion(actor, promo.id);
    expect(
      await db
        .select()
        .from(promotions)
        .where(and(eq(promotions.orgId, actor.orgId))),
    ).toHaveLength(0);
  });

  it("does nothing while a promotion is off or on another day", async () => {
    const off = await createPromotion(
      actor,
      {
        name: "Paused",
        kind: "DOLLAR",
        amount: "5",
        scope: "CATEGORY",
        categoryId,
      },
      [],
    );
    await setPromotionActive(actor, off.id, false);
    const s = await cart([[jar, "1"]]);
    await completeSale(actor, { saleId: s, paymentMethod: "DEBIT" });
    expect(
      (await db.select().from(sales).where(eq(sales.id, s)))[0],
    ).toMatchObject({
      promoDiscount: "0.00",
      promoNames: null,
      total: "48.00",
    });
    await setPromotionActive(actor, off.id, true);
    const tomorrow = ((await storeClock(actor.facilityId)).weekday + 1) % 7;
    await db
      .update(promotions)
      .set({ weekdays: [tomorrow] })
      .where(eq(promotions.id, off.id));
    const s2 = await cart([[jar, "1"]]);
    await completeSale(actor, { saleId: s2, paymentMethod: "DEBIT" });
    expect(
      (await db.select().from(sales).where(eq(sales.id, s2)))[0].promoDiscount,
    ).toBe("0.00");
  });

  it("takes a buy-one-get-one deal off at checkout, and checks the deal's numbers", async () => {
    await expect(
      createPromotion(
        actor,
        { name: "B", kind: "BOGO", amount: "50", buyQty: "0", scope: "ALL" },
        [],
      ),
    ).rejects.toThrow(/whole number/);
    await expect(
      createPromotion(
        actor,
        { name: "B", kind: "BUNDLE", amount: "20", buyQty: "1", scope: "ALL" },
        [],
      ),
    ).rejects.toThrow(/at least 2/);
    await expect(
      createPromotion(
        actor,
        { name: "B", kind: "BOGO", amount: "100", scope: "ALL" },
        [],
      ),
    ).rejects.toThrow(/at most 90%/);
    const deal = await createPromotion(
      actor,
      {
        name: "BOGO Jars",
        kind: "BOGO",
        amount: "50",
        buyQty: "1",
        getQty: "1",
        scope: "ITEM",
        itemId: jar,
      },
      [],
    );
    const s = await cart([[jar, "2"]]);
    await completeSale(actor, { saleId: s, paymentMethod: "DEBIT" });
    // Two $40 jars: the second is half off ($20 off). $60 taxed: 7.20 + 4.80.
    expect(
      (await db.select().from(sales).where(eq(sales.id, s)))[0],
    ).toMatchObject({
      subtotal: "80.00",
      promoDiscount: "20.00",
      promoNames: "BOGO Jars",
      total: "72.00",
    });
    await deletePromotion(actor, deal.id);
  });
});
