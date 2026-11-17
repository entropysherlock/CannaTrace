import Decimal from "decimal.js";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  discountPresets,
  drawerSessions,
  facilities,
  items,
  packages,
  retailPrices,
  retailSettings,
  saleLinePackages,
  saleLines,
  sales,
  type DrawerSession,
  type RetailSettings,
  type Sale,
} from "@/db/schema";
import { db, type Tx } from "./db";
import { parseDate, parseMoney, parsePrice, todayIn } from "./distribution-math";
import { InventoryError, audit, consumeFromPackageInTx, returnToPackageInTx, type Actor } from "./inventory";
import { parsePositiveQty } from "./inventory-math";
import { nextNumber } from "./numbering";
import { combinedCap, effectiveLimits, minimumAge, packFor, requiresLabBeforeRetail, type StatePack } from "./rules";
import {
  cartTotals,
  changeDue,
  checkInProblem,
  expectedCash,
  limitProblem,
  limitUsage,
  parsePercent,
  type CustomerType,
  type LimitCategory,
  type Totals,
} from "./pos-math";

const store = (value: Decimal) => value.toFixed(4);
export const SALE_PAYMENT_METHODS = ["CASH", "DEBIT"] as const;

/** Until a manager saves real figures, a store has no limits or tax rates and cannot sell. */
const UNSET = {
  flowerLimitGrams: "0",
  concentrateLimitGrams: "0",
  edibleLimitMg: "0",
  exciseTaxPercent: "0",
  salesTaxPercent: "0",
  medicalTaxExempt: true,
  adultMinAge: 21,
  medicalMinAge: 18,
};

export async function getRetailSettings(
  tx: Tx | typeof db,
  facilityId: string,
): Promise<Omit<RetailSettings, "facilityId" | "orgId"> & { saved: boolean }> {
  const [row] = await tx.select().from(retailSettings).where(eq(retailSettings.facilityId, facilityId));
  return row ? { ...row, saved: true } : { ...UNSET, saved: false };
}

export async function saveRetailSettings(
  actor: Actor,
  input: {
    flowerLimitGrams: unknown;
    concentrateLimitGrams: unknown;
    edibleLimitMg: unknown;
    exciseTaxPercent: unknown;
    salesTaxPercent: unknown;
    medicalTaxExempt: boolean;
  },
): Promise<void> {
  const values = {
    flowerLimitGrams: store(parsePositiveQty(input.flowerLimitGrams, "Flower limit")),
    concentrateLimitGrams: store(parsePositiveQty(input.concentrateLimitGrams, "Concentrate limit")),
    edibleLimitMg: store(parsePositiveQty(input.edibleLimitMg, "Edible limit")),
    exciseTaxPercent: parsePercent(input.exciseTaxPercent, "Cannabis excise tax", 50).toFixed(3),
    salesTaxPercent: parsePercent(input.salesTaxPercent, "Sales tax", 50).toFixed(3),
    medicalTaxExempt: input.medicalTaxExempt,
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(retailSettings)
      .values({ facilityId: actor.facilityId, orgId: actor.orgId, ...values })
      .onConflictDoUpdate({ target: retailSettings.facilityId, set: values });
    await audit(tx, actor, { entityType: "RetailSettings", entityId: actor.facilityId, action: "SAVE", after: values });
  });
}

/** Put an item on this store's menu (or change it): its shelf price and how it counts toward purchase limits. */
export async function setMenuItem(
  actor: Actor,
  input: { itemId: string; price: unknown; limitCategory: string; limitPerUnit?: unknown },
): Promise<void> {
  const price = parsePrice(input.price, "Shelf price");
  if (price.lte(0)) throw new InventoryError("Shelf price must be more than zero.");
  if (!["NONE", "FLOWER", "CONCENTRATE", "EDIBLE"].includes(input.limitCategory)) throw new InventoryError("Choose how this item counts toward purchase limits.");
  const limitCategory = input.limitCategory as LimitCategory;
  const limitPerUnit =
    limitCategory === "NONE"
      ? null
      : store(parsePositiveQty(input.limitPerUnit, limitCategory === "EDIBLE" ? "Milligrams of THC per unit" : "Grams per unit"));
  await db.transaction(async (tx) => {
    const [item] = await tx
      .update(items)
      .set({ limitCategory, limitPerUnit })
      .where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId)))
      .returning({ id: items.id, name: items.name });
    if (!item) throw new InventoryError("Pick an item from the list.");
    await tx
      .insert(retailPrices)
      .values({ facilityId: actor.facilityId, itemId: item.id, price: store(price) })
      .onConflictDoUpdate({ target: [retailPrices.facilityId, retailPrices.itemId], set: { price: store(price) } });
    await audit(tx, actor, {
      entityType: "MenuItem",
      entityId: item.id,
      action: "SAVE",
      after: { item: item.name, price: price.toString(), limitCategory, limitPerUnit },
    });
  });
}

export async function createDiscount(actor: Actor, input: { name: string; percent: unknown }): Promise<void> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new InventoryError("Give the discount a name, for example Veteran 10%.");
  const percent = parsePercent(input.percent, "Discount");
  if (percent.lte(0)) throw new InventoryError("Discount must be more than zero.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(discountPresets)
      .values({ orgId: actor.orgId, name, percent: percent.toFixed(3) })
      .onConflictDoNothing({ target: [discountPresets.orgId, discountPresets.name] })
      .returning({ id: discountPresets.id });
    if (!row) throw new InventoryError(`There is already a discount called ${name}.`);
    await audit(tx, actor, { entityType: "Discount", entityId: row.id, action: "CREATE", after: { name, percent: percent.toString() } });
  });
}

// ---------- Cash drawer ----------

async function lockOpenDrawer(tx: Tx, actor: Actor): Promise<DrawerSession | null> {
  const [session] = await tx
    .select()
    .from(drawerSessions)
    .where(and(eq(drawerSessions.orgId, actor.orgId), eq(drawerSessions.facilityId, actor.facilityId), eq(drawerSessions.status, "OPEN")))
    .for("update");
  return session ?? null;
}

export async function openDrawer(actor: Actor, input: { openingCash: unknown }): Promise<DrawerSession> {
  const openingCash = parseMoney(input.openingCash, "Opening cash", { allowZero: true });
  return db.transaction(async (tx) => {
    // Serialise drawer opening per facility so two people cannot open two drawers at once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`drawer:${actor.facilityId}`}))`);
    if (await lockOpenDrawer(tx, actor)) throw new InventoryError("The drawer is already open at this store.");
    const [session] = await tx
      .insert(drawerSessions)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, openingCash: openingCash.toFixed(2), openedByName: actor.userName })
      .returning();
    await audit(tx, actor, { entityType: "Drawer", entityId: session.id, action: "OPEN", after: { openingCash: openingCash.toFixed(2) } });
    return session;
  });
}

export type DrawerSummary = {
  saleCount: number;
  voidCount: number;
  subtotal: Decimal;
  discounts: Decimal;
  exciseTax: Decimal;
  salesTax: Decimal;
  total: Decimal;
  cashTotal: Decimal;
  debitTotal: Decimal;
  expectedCash: Decimal;
};

export async function drawerSummary(tx: Tx | typeof db, session: DrawerSession): Promise<DrawerSummary> {
  const rows = await tx.select().from(sales).where(eq(sales.drawerSessionId, session.id));
  const done = rows.filter((s) => s.status === "COMPLETED");
  const sum = (pick: (s: Sale) => string | null) => done.reduce((acc, s) => acc.add(pick(s) ?? 0), new Decimal(0));
  const cash = done.filter((s) => s.paymentMethod === "CASH");
  return {
    saleCount: done.length,
    voidCount: rows.filter((s) => s.status === "VOIDED").length,
    subtotal: sum((s) => s.subtotal),
    discounts: sum((s) => s.discountTotal),
    exciseTax: sum((s) => s.exciseTax),
    salesTax: sum((s) => s.salesTax),
    total: sum((s) => s.total),
    cashTotal: cash.reduce((acc, s) => acc.add(s.total ?? 0), new Decimal(0)),
    debitTotal: done.filter((s) => s.paymentMethod === "DEBIT").reduce((acc, s) => acc.add(s.total ?? 0), new Decimal(0)),
    expectedCash: expectedCash(session.openingCash, cash.map((s) => s.total ?? "0")),
  };
}

/** Close the drawer with a cash count. Open carts must be finished or cancelled first. */
export async function closeDrawer(actor: Actor, input: { countedCash: unknown }): Promise<{ id: string; variance: string }> {
  const counted = parseMoney(input.countedCash, "Counted cash", { allowZero: true });
  return db.transaction(async (tx) => {
    const session = await lockOpenDrawer(tx, actor);
    if (!session) throw new InventoryError("There is no open drawer to close.");
    const openCarts = await tx.$count(sales, and(eq(sales.drawerSessionId, session.id), eq(sales.status, "OPEN")));
    if (openCarts > 0) {
      throw new InventoryError(`${openCarts} cart${openCarts === 1 ? " is" : "s are"} still open. Finish or cancel ${openCarts === 1 ? "it" : "them"} before closing the drawer.`);
    }
    const summary = await drawerSummary(tx, session);
    await tx
      .update(drawerSessions)
      .set({
        status: "CLOSED",
        countedCash: counted.toFixed(2),
        expectedCash: summary.expectedCash.toFixed(2),
        closedByName: actor.userName,
        closedAt: new Date(),
      })
      .where(eq(drawerSessions.id, session.id));
    const variance = counted.sub(summary.expectedCash).toFixed(2);
    await audit(tx, actor, {
      entityType: "Drawer",
      entityId: session.id,
      action: "CLOSE",
      after: { countedCash: counted.toFixed(2), expectedCash: summary.expectedCash.toFixed(2), variance },
    });
    return { id: session.id, variance };
  });
}

// ---------- Sales ----------

/**
 * Check a customer's ID and start a cart for them. The birth date is used for the age
 * check only and is not stored.
 */
export async function checkInCustomer(
  actor: Actor,
  input: { birthDate: string; idExpires: string; customerType: string },
): Promise<Sale> {
  if (input.customerType !== "ADULT_USE" && input.customerType !== "MEDICAL") throw new InventoryError("Choose adult-use or medical.");
  const customerType: CustomerType = input.customerType;
  const birthDate = parseDate(input.birthDate, "Date of birth");
  const idExpires = parseDate(input.idExpires, "ID expiry date");
  return db.transaction(async (tx) => {
    const settings = await getRetailSettings(tx, actor.facilityId);
    if (!settings.saved) {
      throw new InventoryError("This store's purchase limits and tax rates have not been entered yet. A manager must save them under Menu and store rules before anyone can sell.");
    }
    const pack = await storePack(tx, actor.facilityId);
    const ages = { adultMinAge: minimumAge(settings.adultMinAge, pack, "ADULT_USE"), medicalMinAge: minimumAge(settings.medicalMinAge, pack, "MEDICAL") };
    const problem = checkInProblem({ birthDate, idExpires, customerType }, ages, todayIn());
    if (problem) throw new InventoryError(problem);
    const session = await lockOpenDrawer(tx, actor);
    if (!session) throw new InventoryError("Open the cash drawer before serving customers.");
    const number = await nextNumber(tx, actor.facilityId, "S");
    const [sale] = await tx
      .insert(sales)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        drawerSessionId: session.id,
        number,
        customerType,
        userId: actor.userId,
        userName: actor.userName,
      })
      .returning();
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "CHECK_IN", after: { number, customerType, idChecked: true } });
    return sale;
  });
}

async function lockSale(tx: Tx, actor: Actor, saleId: string, allowed: Sale["status"][], verb: string): Promise<Sale> {
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.orgId, actor.orgId), eq(sales.facilityId, actor.facilityId)))
    .for("update");
  if (!sale) throw new InventoryError("That sale was not found at this store.");
  if (!allowed.includes(sale.status)) throw new InventoryError(`Sale ${sale.number} is ${sale.status.toLowerCase()} and cannot be ${verb}.`);
  return sale;
}

export type CartRow = {
  id: string;
  itemId: string;
  itemName: string;
  unit: (typeof items.$inferSelect)["unit"];
  quantity: string;
  unitPrice: string;
  limitCategory: LimitCategory;
  limitPerUnit: string | null;
};

export async function cartLines(tx: Tx | typeof db, saleId: string): Promise<CartRow[]> {
  return tx
    .select({
      id: saleLines.id,
      itemId: saleLines.itemId,
      itemName: items.name,
      unit: items.unit,
      quantity: saleLines.quantity,
      unitPrice: saleLines.unitPrice,
      limitCategory: items.limitCategory,
      limitPerUnit: items.limitPerUnit,
    })
    .from(saleLines)
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(items.name));
}

export function saleTotals(lines: CartRow[], sale: Pick<Sale, "discountPercent" | "customerType">, settings: Awaited<ReturnType<typeof getRetailSettings>>): Totals {
  return cartTotals(lines, {
    discountPercent: sale.discountPercent,
    exciseTaxPercent: settings.exciseTaxPercent,
    salesTaxPercent: settings.salesTaxPercent,
    taxExempt: sale.customerType === "MEDICAL" && settings.medicalTaxExempt,
  });
}

function limitsOf(settings: Awaited<ReturnType<typeof getRetailSettings>>) {
  return {
    FLOWER: new Decimal(settings.flowerLimitGrams),
    CONCENTRATE: new Decimal(settings.concentrateLimitGrams),
    EDIBLE: new Decimal(settings.edibleLimitMg),
  };
}

/** The state rule pack for the store's facility, or null when its state has none yet. */
export async function storePack(tx: Tx | typeof db, facilityId: string): Promise<StatePack | null> {
  const [row] = await tx.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, facilityId));
  return packFor(row?.state);
}

/** A package's most recent lab result passed. */
const passedLab = sql`(select lr.status from lab_results lr where lr.package_id = ${packages.id} order by lr.created_at desc limit 1) = 'PASS'`;

/** Sellable stock of an item at this store: active packages, and only lab-passed ones where the state requires testing. */
async function inStock(tx: Tx, actor: Actor, itemId: string, pack: StatePack | null): Promise<{ sellable: Decimal; waitingOnLab: Decimal }> {
  const gate = requiresLabBeforeRetail(pack);
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${packages.quantity}), 0)`,
      passed: sql<string>`coalesce(sum(${packages.quantity}) filter (where ${passedLab}), 0)`,
    })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.itemId, itemId), eq(packages.status, "ACTIVE")));
  const total = new Decimal(row.total);
  const sellable = gate ? new Decimal(row.passed) : total;
  return { sellable, waitingOnLab: total.sub(sellable) };
}

/** The first purchase limit this cart breaks, using the stricter of the store's and the state's numbers. */
function limitCheck(lines: Parameters<typeof limitUsage>[0], settings: Awaited<ReturnType<typeof getRetailSettings>>, pack: StatePack | null, customer: CustomerType) {
  const { limits, fromState } = effectiveLimits(limitsOf(settings), pack, customer);
  const usage = limitUsage(lines);
  const problem = limitProblem(usage, limits);
  const together = combinedCap(pack, customer);
  if (!problem && pack && together && usage.FLOWER.add(usage.CONCENTRATE).gt(together)) {
    return `That puts the cart at ${usage.FLOWER.add(usage.CONCENTRATE).toString()} g of flower and concentrate together. ${pack.name} law allows ${together.toString()} g per purchase.`;
  }
  if (!problem || !pack) return problem;
  const broken = (["FLOWER", "CONCENTRATE", "EDIBLE"] as const).find((k) => usage[k].gt(limits[k]));
  return broken && fromState.has(broken) ? problem.replace(/The limit is (.+) per purchase\.$/, `${pack.name} law allows $1 per purchase.`) : problem;
}

/** Add to the cart. Adding an item that is already there increases its quantity. */
export async function addToCart(actor: Actor, input: { saleId: string; itemId: string; quantity: unknown }): Promise<void> {
  const quantity = parsePositiveQty(input.quantity);
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    const [item] = await tx
      .select({ id: items.id, name: items.name, price: retailPrices.price })
      .from(items)
      .innerJoin(retailPrices, and(eq(retailPrices.itemId, items.id), eq(retailPrices.facilityId, actor.facilityId)))
      .where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId), eq(items.active, true)));
    if (!item) throw new InventoryError("That item is not on this store's menu.");

    const before = await cartLines(tx, sale.id);
    const existing = before.find((line) => line.itemId === item.id);
    const newQuantity = quantity.add(existing?.quantity ?? 0);
    const pack = await storePack(tx, actor.facilityId);
    const { sellable, waitingOnLab } = await inStock(tx, actor, item.id, pack);
    if (newQuantity.gt(sellable)) {
      const lab = waitingOnLab.gt(0) && pack ? ` ${waitingOnLab.toString()} more is waiting on a passing lab result, which ${pack.name} requires before sale.` : "";
      throw new InventoryError(
        `Only ${sellable.toString()} of ${item.name} ${lab ? "can be sold" : "is in stock"}${existing ? `, and ${new Decimal(existing.quantity).toString()} is already in the cart` : ""}.${lab}`,
      );
    }
    if (existing) {
      await tx.update(saleLines).set({ quantity: store(newQuantity) }).where(eq(saleLines.id, existing.id));
    } else {
      await tx.insert(saleLines).values({ saleId: sale.id, itemId: item.id, quantity: store(quantity), unitPrice: item.price });
    }
    const problem = limitCheck(await cartLines(tx, sale.id), await getRetailSettings(tx, actor.facilityId), pack, sale.customerType);
    if (problem) throw new InventoryError(problem);
  });
}

export async function removeFromCart(actor: Actor, input: { lineId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(saleLines).where(eq(saleLines.id, input.lineId));
    if (!line) return;
    await lockSale(tx, actor, line.saleId, ["OPEN"], "changed");
    await tx.delete(saleLines).where(eq(saleLines.id, line.id));
  });
}

export async function setCartDiscount(actor: Actor, input: { saleId: string; discountId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    if (!input.discountId) {
      await tx.update(sales).set({ discountName: null, discountPercent: "0" }).where(eq(sales.id, sale.id));
      return;
    }
    const [discount] = await tx
      .select()
      .from(discountPresets)
      .where(and(eq(discountPresets.id, input.discountId), eq(discountPresets.orgId, actor.orgId), eq(discountPresets.active, true)));
    if (!discount) throw new InventoryError("Pick a discount from the list.");
    await tx.update(sales).set({ discountName: discount.name, discountPercent: discount.percent }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "DISCOUNT", after: { name: discount.name, percent: discount.percent } });
  });
}

export async function cancelCart(actor: Actor, input: { saleId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "cancelled");
    await tx.update(sales).set({ status: "CANCELLED", completedAt: new Date() }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "CANCEL" });
  });
}

/** Take payment. Stock comes out of the oldest packages first, and each package used is recorded. */
export async function completeSale(
  actor: Actor,
  input: { saleId: string; paymentMethod: string; cashTendered?: unknown },
): Promise<{ number: string; total: string; changeDue: string }> {
  if (!(SALE_PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) throw new InventoryError("Choose cash or debit.");
  return db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "paid again");
    const [session] = await tx.select().from(drawerSessions).where(eq(drawerSessions.id, sale.drawerSessionId));
    if (session.status !== "OPEN") throw new InventoryError("This cart belongs to a drawer that has been closed. Cancel it and start a new one.");
    const lines = await cartLines(tx, sale.id);
    if (lines.length === 0) throw new InventoryError("The cart is empty.");
    const settings = await getRetailSettings(tx, actor.facilityId);
    const pack = await storePack(tx, actor.facilityId);
    const problem = limitCheck(lines, settings, pack, sale.customerType);
    if (problem) throw new InventoryError(problem);
    const labGate = requiresLabBeforeRetail(pack);

    const totals = saleTotals(lines, sale, settings);
    let tendered: Decimal | null = null;
    let change = new Decimal(0);
    if (input.paymentMethod === "CASH") {
      tendered = parseMoney(input.cashTendered, "Cash handed over", { allowZero: totals.total.isZero() });
      change = changeDue(totals.total, tendered);
    }

    for (const line of lines) {
      let need = new Decimal(line.quantity);
      const candidates = await tx
        .select({ id: packages.id, quantity: packages.quantity })
        .from(packages)
        .where(
          and(
            eq(packages.orgId, actor.orgId),
            eq(packages.facilityId, actor.facilityId),
            eq(packages.itemId, line.itemId),
            eq(packages.status, "ACTIVE"),
            labGate ? passedLab : undefined,
          ),
        )
        .orderBy(asc(packages.createdAt), asc(packages.id))
        .for("update");
      for (const candidate of candidates) {
        if (need.lte(0)) break;
        const take = Decimal.min(need, candidate.quantity);
        await consumeFromPackageInTx(tx, actor, { packageId: candidate.id, quantity: take, note: `Retail sale ${sale.number}`, kind: "RETAIL_SALE" });
        await tx.insert(saleLinePackages).values({ saleLineId: line.id, packageId: candidate.id, quantity: store(take) });
        need = need.sub(take);
      }
      if (need.gt(0)) {
        throw new InventoryError(`${line.itemName} sold out while this cart was open. Only ${new Decimal(line.quantity).sub(need).toString()} is left. Change the cart and try again.`);
      }
    }

    await tx
      .update(sales)
      .set({
        status: "COMPLETED",
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discount.toFixed(2),
        exciseTax: totals.exciseTax.toFixed(2),
        salesTax: totals.salesTax.toFixed(2),
        total: totals.total.toFixed(2),
        paymentMethod: input.paymentMethod,
        cashTendered: tendered?.toFixed(2) ?? null,
        changeDue: change.toFixed(2),
        completedAt: new Date(),
      })
      .where(eq(sales.id, sale.id));
    await audit(tx, actor, {
      entityType: "Sale",
      entityId: sale.id,
      action: "COMPLETE",
      after: { number: sale.number, total: totals.total.toFixed(2), paymentMethod: input.paymentMethod, lines: lines.length },
    });
    return { number: sale.number, total: totals.total.toFixed(2), changeDue: change.toFixed(2) };
  });
}

/** Undo a completed sale from the current shift: the product goes back into the packages it came from. */
export async function voidSale(actor: Actor, input: { saleId: string; reason: string }): Promise<void> {
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new InventoryError("Say why the sale is being voided. It goes in the audit trail.");
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["COMPLETED"], "voided");
    const [session] = await tx.select().from(drawerSessions).where(eq(drawerSessions.id, sale.drawerSessionId)).for("update");
    if (session.status !== "OPEN") {
      throw new InventoryError("This sale is from a drawer that has already been closed and counted, so it cannot be voided here.");
    }
    const taken = await tx
      .select({ packageId: saleLinePackages.packageId, quantity: saleLinePackages.quantity })
      .from(saleLinePackages)
      .innerJoin(saleLines, eq(saleLines.id, saleLinePackages.saleLineId))
      .where(eq(saleLines.saleId, sale.id))
      .orderBy(asc(saleLinePackages.packageId));
    for (const row of taken) {
      await returnToPackageInTx(tx, actor, {
        packageId: row.packageId,
        quantity: new Decimal(row.quantity),
        note: `Sale ${sale.number} voided: ${reason}`,
        auditAction: "RETURNED_FROM_VOIDED_SALE",
      });
    }
    await tx.update(sales).set({ status: "VOIDED", voidReason: reason }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "VOID", after: { number: sale.number, total: sale.total }, reason });
  });
}
