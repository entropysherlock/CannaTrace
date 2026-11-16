import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drawerSessions, facilities, itemCategories, items, locations, organizations, packages, saleLinePackages, sales, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { receivePackage, setPackageStatus, type Actor } from "@/lib/inventory";
import {
  addToCart,
  cancelCart,
  checkInCustomer,
  closeDrawer,
  completeSale,
  createDiscount,
  drawerSummary,
  openDrawer,
  removeFromCart,
  saveRetailSettings,
  setCartDiscount,
  setMenuItem,
  voidSale,
} from "@/lib/pos";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `P${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;
const today = todayIn();
const adult = { birthDate: "1990-05-05", idExpires: addDays(today, 400), customerType: "ADULT_USE" };

let actor: Actor;
let other: Actor;
let jar: string;
let gummies: string;
let papers: string;
let offMenu: string;
let shelf: string;
let discountId: string;

const qty = async (id: string) => new Decimal((await db.select().from(packages).where(eq(packages.id, id)))[0].quantity).toString();
const sale = async (id: string) => (await db.select().from(sales).where(eq(sales.id, id)))[0];
const lineId = async (saleId: string, itemId: string) =>
  (await db.execute<{ id: string }>(sql`select id from sale_lines where sale_id = ${saleId} and item_id = ${itemId}`)).rows[0].id;

describe.skipIf(!hasDb)("point of sale engine (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `POS Org ${run}` }).returning();
    const [facility, second] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" },
        { orgId: org.id, name: "Other Shop", licenseNumber: `${run}-B`, licenseType: "RETAIL", state: "NM" },
      ])
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Bud Tender", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" })
      .returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db
      .insert(items)
      .values(["Jar 3.5", "Gummies 100mg", "Papers", "Off Menu"].map((name, i) => ({ orgId: org.id, name, sku: `SKU${i}`, categoryId: category.id, unit: "EACH" as const })))
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    other = { ...actor, facilityId: second.id };
    shelf = location.id;
    [jar, gummies, papers, offMenu] = made.map((i) => i.id);

    await saveRetailSettings(actor, {
      flowerLimitGrams: "56.7",
      concentrateLimitGrams: "16",
      edibleLimitMg: "800",
      exciseTaxPercent: "14",
      salesTaxPercent: "7.625",
      medicalTaxExempt: true,
    });
    await setMenuItem(actor, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await setMenuItem(actor, { itemId: gummies, price: "8.33", limitCategory: "EDIBLE", limitPerUnit: "100" });
    await setMenuItem(actor, { itemId: papers, price: "2", limitCategory: "NONE" });
    await createDiscount(actor, { name: "Veteran", percent: "10" });
    discountId = (await db.execute<{ id: string }>(sql`select id from discount_presets where org_id = ${org.id}`)).rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("will not sell at a store whose limits and tax rates were never entered", async () => {
    const [bare] = await db
      .insert(facilities)
      .values({ orgId: actor.orgId, name: "No Rules Shop", licenseNumber: `${run}-C`, licenseType: "RETAIL", state: "NM" })
      .returning();
    const bareActor = { ...actor, facilityId: bare.id };
    await openDrawer(bareActor, { openingCash: "0" });
    await expect(checkInCustomer(bareActor, adult)).rejects.toThrow(/have not been entered yet/);
  });

  it("will not serve anyone before the drawer is open, or anyone under age", async () => {
    await expect(checkInCustomer(actor, adult)).rejects.toThrow(/Open the cash drawer/);
    await openDrawer(actor, { openingCash: "200" });
    await expect(openDrawer(actor, { openingCash: "50" })).rejects.toThrow(/already open/);
    const twentyToday = `${Number(today.slice(0, 4)) - 21}${today.slice(4)}`;
    await expect(checkInCustomer(actor, { ...adult, birthDate: addDays(twentyToday, 1) })).rejects.toThrow(/minimum age is 21/);
    await expect(checkInCustomer(actor, { ...adult, idExpires: addDays(today, -1) })).rejects.toThrow(/expired/);
    const cart = await checkInCustomer(actor, { ...adult, birthDate: twentyToday });
    expect(cart.number).toMatch(/^S-\d{5}$/);
    await cancelCart(actor, { saleId: cart.id });
  });

  it("sells oldest stock first and records every package used", async () => {
    const oldest = await receivePackage(actor, { tag: tag(), itemId: jar, quantity: "2", locationId: shelf });
    const newer = await receivePackage(actor, { tag: tag(), itemId: jar, quantity: "10", locationId: shelf });
    const held = await receivePackage(actor, { tag: tag(), itemId: jar, quantity: "50", locationId: shelf });
    await setPackageStatus(actor, { packageId: held.id, status: "ON_HOLD", reason: "Awaiting COA" });
    const gum = await receivePackage(actor, { tag: tag(), itemId: gummies, quantity: "20", locationId: shelf });
    await receivePackage(actor, { tag: tag(), itemId: papers, quantity: "100", locationId: shelf });

    const cart = await checkInCustomer(actor, adult);
    await expect(addToCart(actor, { saleId: cart.id, itemId: offMenu, quantity: "1" })).rejects.toThrow(/not on this store's menu/);
    await expect(addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "13" })).rejects.toThrow(/Only 12 of Jar 3.5 is in stock/);
    await addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "1" });
    await addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "2" });
    await addToCart(actor, { saleId: cart.id, itemId: gummies, quantity: "3" });
    await addToCart(actor, { saleId: cart.id, itemId: papers, quantity: "1" });
    await removeFromCart(actor, { lineId: await lineId(cart.id, papers) });
    await setCartDiscount(actor, { saleId: cart.id, discountId });

    await expect(completeSale(actor, { saleId: cart.id, paymentMethod: "BITCOIN" })).rejects.toThrow(/cash or debit/);
    await expect(completeSale(actor, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "100" })).rejects.toThrow(/only \$100.00 was handed over/);
    expect(await qty(oldest.id)).toBe("2"); // a failed payment takes nothing

    // 3 x 35 + 3 x 8.33 = 129.99; less 10% = 116.99; excise 14% = 16.38; sales tax 7.625% = 8.92; total 142.29
    const paid = await completeSale(actor, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "150" });
    expect(paid).toMatchObject({ total: "142.29", changeDue: "7.71" });
    expect(await qty(oldest.id)).toBe("0");
    expect(await qty(newer.id)).toBe("9");
    expect(await qty(held.id)).toBe("50");
    expect(await qty(gum.id)).toBe("17");
    const used = await db.select().from(saleLinePackages).where(eq(saleLinePackages.saleLineId, await lineId(cart.id, jar)));
    expect(used.map((u) => [u.packageId, new Decimal(u.quantity).toString()]).sort()).toEqual(
      [
        [oldest.id, "2"],
        [newer.id, "1"],
      ].sort(),
    );
    const row = await sale(cart.id);
    expect(row).toMatchObject({ status: "COMPLETED", subtotal: "129.99", discountTotal: "13.00", exciseTax: "16.38", salesTax: "8.92" });
    await expect(addToCart(actor, { saleId: cart.id, itemId: papers, quantity: "1" })).rejects.toThrow(/completed/);
    await expect(completeSale(other, { saleId: cart.id, paymentMethod: "DEBIT" })).rejects.toThrow(/not found/);
  });

  it("enforces purchase limits when adding and again at payment", async () => {
    await receivePackage(actor, { tag: tag(), itemId: jar, quantity: "40", locationId: shelf });
    const cart = await checkInCustomer(actor, adult);
    await addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "16" }); // 56 g, under 56.7
    await expect(addToCart(actor, { saleId: cart.id, itemId: jar, quantity: "1" })).rejects.toThrow(/59.5 g of flower. The limit is 56.7 g/);
    await expect(addToCart(actor, { saleId: cart.id, itemId: gummies, quantity: "9" })).rejects.toThrow(/900 mg of edible thc/);
    const lines = await db.execute<{ quantity: string }>(sql`select quantity from sale_lines where sale_id = ${cart.id}`);
    expect(lines.rows).toHaveLength(1); // the refused lines were not kept
    expect(new Decimal(lines.rows[0].quantity).toString()).toBe("16");
    // Limit lowered by a manager after the cart was built: payment is refused
    await saveRetailSettings(actor, { flowerLimitGrams: "28", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    await expect(completeSale(actor, { saleId: cart.id, paymentMethod: "DEBIT" })).rejects.toThrow(/limit is 28 g/);
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    await cancelCart(actor, { saleId: cart.id });
  });

  it("charges medical patients no tax and takes debit without change", async () => {
    const cart = await checkInCustomer(actor, { birthDate: `${Number(today.slice(0, 4)) - 19}-01-01`, idExpires: addDays(today, 30), customerType: "MEDICAL" });
    await addToCart(actor, { saleId: cart.id, itemId: gummies, quantity: "2" });
    const paid = await completeSale(actor, { saleId: cart.id, paymentMethod: "DEBIT" });
    expect(paid).toMatchObject({ total: "16.66", changeDue: "0.00" });
    expect(await sale(cart.id)).toMatchObject({ exciseTax: "0.00", salesTax: "0.00", paymentMethod: "DEBIT" });
  });

  it("fails cleanly when stock is taken by someone else before payment", async () => {
    const only = await receivePackage(actor, { tag: tag(), itemId: papers, quantity: "5", locationId: shelf });
    await db.execute(sql`update packages set status = 'ON_HOLD' where item_id = ${papers} and id <> ${only.id}`);
    const first = await checkInCustomer(actor, adult);
    const second = await checkInCustomer(actor, adult);
    await addToCart(actor, { saleId: first.id, itemId: papers, quantity: "4" });
    await addToCart(actor, { saleId: second.id, itemId: papers, quantity: "4" });
    await completeSale(actor, { saleId: first.id, paymentMethod: "DEBIT" });
    await expect(completeSale(actor, { saleId: second.id, paymentMethod: "DEBIT" })).rejects.toThrow(/sold out while this cart was open. Only 1 is left/);
    expect(await qty(only.id)).toBe("1");
    expect((await sale(second.id)).status).toBe("OPEN");
    await expect(closeDrawer(actor, { countedCash: "0" })).rejects.toThrow(/1 cart is still open/);
    await cancelCart(actor, { saleId: second.id });
  });

  it("voids a sale back into its packages, then closes the drawer with the right expected cash", async () => {
    const stock = await receivePackage(actor, { tag: tag(), itemId: gummies, quantity: "6", locationId: shelf });
    await db.execute(sql`update packages set status = 'ON_HOLD' where item_id = ${gummies} and id <> ${stock.id} and status = 'ACTIVE'`);
    const cart = await checkInCustomer(actor, adult);
    await addToCart(actor, { saleId: cart.id, itemId: gummies, quantity: "6" });
    await completeSale(actor, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "100" });
    expect((await db.select().from(packages).where(eq(packages.id, stock.id)))[0]).toMatchObject({ status: "FINISHED" });
    await expect(voidSale(actor, { saleId: cart.id, reason: " " })).rejects.toThrow(/why/);
    await voidSale(actor, { saleId: cart.id, reason: "Rang up wrong customer" });
    expect((await db.select().from(packages).where(eq(packages.id, stock.id)))[0]).toMatchObject({ status: "ACTIVE" });
    expect(await qty(stock.id)).toBe("6");
    await expect(voidSale(actor, { saleId: cart.id, reason: "again" })).rejects.toThrow(/voided/);

    const [session] = await db.select().from(drawerSessions).where(eq(drawerSessions.id, cart.drawerSessionId));
    const summary = await drawerSummary(db, session);
    // Completed: 142.29 cash, 16.66 debit, 8 papers debit (4 x 2 + taxes). The voided cash sale is excluded.
    expect(summary.saleCount).toBe(3);
    expect(summary.voidCount).toBe(1);
    expect(summary.cashTotal.toString()).toBe("142.29");
    expect(summary.expectedCash.toString()).toBe("342.29");

    const closed = await closeDrawer(actor, { countedCash: "340.29" });
    expect(closed.variance).toBe("-2.00");
    await expect(checkInCustomer(actor, adult)).rejects.toThrow(/Open the cash drawer/);
    await expect(voidSale(actor, { saleId: (await db.select().from(sales).where(eq(sales.drawerSessionId, session.id)))[0].id, reason: "late" })).rejects.toThrow();
  });

  it("keeps the ledger consistent with package quantities", async () => {
    const rows = await db.execute(sql`
      select p.id from packages p join inventory_transactions t on t.package_id = p.id
      where p.org_id = ${actor.orgId} group by p.id, p.quantity having sum(t.quantity_delta) <> p.quantity
    `);
    expect(rows.rows).toHaveLength(0);
  });
});
