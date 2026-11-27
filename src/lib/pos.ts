import { createHmac } from "node:crypto";
import Decimal from "decimal.js";
import { inArray, and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  discountPresets,
  drawerSessions,
  facilities,
  items,
  packages,
  retailPrices,
  retailSettings,
  rewardMembers,
  orderAllocations,
  saleLinePackages,
  saleLines,
  salePromotions,
  saleReturnLines,
  saleReturns,
  sales,
  type DrawerSession,
  type RetailSettings,
  type Sale,
} from "@/db/schema";
import { atomically, db, type Tx } from "./db";
import { parseDate, parseMoney, parsePrice, todayIn } from "./distribution-math";
import { cartPromos } from "./promotions";
import { MAX_PROMO_PERCENT } from "./promotions-math";
import { InventoryError, adjustPackage, audit, consumeFromPackageInTx, lockPackage, returnToPackageInTx, type Actor } from "./inventory";
import { assertWholeForUnit, parsePositiveQty } from "./inventory-math";
import { nextNumber } from "./numbering";
import { combinedCap, effectiveLimits, minimumAge, packFor, requiresLabBeforeRetail, type StatePack } from "./rules";
import { facilityToday, facilityZone } from "./time";
import { createMember, expireIfIdle, findMemberByIdKey, findMemberByPhone, getProgram, lockMember, reverseSaleRewards, settleSaleRewards, takeBackForReturn } from "./rewards";
import { normalizePhone, rewardsThatFit, type RewardProgram } from "./rewards-math";
import {
  cartTotals,
  cleanCardDetails,
  checkInProblem,
  expectedCash,
  limitProblem,
  limitUsage,
  parsePercent,
  settlePayment,
  type PaymentMethod,
  type CustomerType,
  type LimitCategory,
  type Totals,
} from "./pos-math";

const store = (value: Decimal) => value.toFixed(4);
export const SALE_PAYMENT_METHODS = ["CASH", "DEBIT", "SPLIT"] as const;

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
  dailyLimits: false,
  receiptWarning: null as string | null,
  labelWarning: null as string | null,
};

/** A state whose purchase limits are per day starts with per-customer daily limits ON, so the first sale is not unchecked (APEX-22). */
async function stateCountsPerDay(tx: Tx | typeof db, facilityId: string): Promise<boolean> {
  const [f] = await tx.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, facilityId));
  return (packFor(f?.state)?.rules ?? []).some((r) => r.kind === "PURCHASE_LIMIT" && r.period === "DAY");
}

export async function getRetailSettings(
  tx: Tx | typeof db,
  facilityId: string,
): Promise<Omit<RetailSettings, "facilityId" | "orgId"> & { saved: boolean }> {
  const [row] = await tx.select().from(retailSettings).where(eq(retailSettings.facilityId, facilityId));
  return row ? { ...row, saved: true } : { ...UNSET, dailyLimits: await stateCountsPerDay(tx, facilityId), saved: false };
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
    dailyLimits?: boolean;
    receiptWarning?: string | null;
    labelWarning?: string | null;
  },
): Promise<void> {
  const words = (v: string | null | undefined, what: string) => {
    const t = (v ?? "").replace(/\r\n/g, "\n").trim();
    if (t.length > 1500) throw new InventoryError(`${what} is too long (1,500 characters at most).`);
    return t || null;
  };
  const values = {
    flowerLimitGrams: store(parsePositiveQty(input.flowerLimitGrams, "Flower limit")),
    concentrateLimitGrams: store(parsePositiveQty(input.concentrateLimitGrams, "Concentrate limit")),
    edibleLimitMg: store(parsePositiveQty(input.edibleLimitMg, "Edible limit")),
    exciseTaxPercent: parsePercent(input.exciseTaxPercent, "Cannabis excise tax", 50).toFixed(3),
    salesTaxPercent: parsePercent(input.salesTaxPercent, "Sales tax", 50).toFixed(3),
    medicalTaxExempt: input.medicalTaxExempt,
    ...(input.dailyLimits !== undefined ? { dailyLimits: input.dailyLimits } : {}),
    ...(input.receiptWarning !== undefined ? { receiptWarning: words(input.receiptWarning, "The receipt warning") } : {}),
    ...(input.labelWarning !== undefined ? { labelWarning: words(input.labelWarning, "The label warning") } : {}),
  };
  await db.transaction(async (tx) => {
    const firstSave = values.dailyLimits === undefined && (await tx.$count(retailSettings, eq(retailSettings.facilityId, actor.facilityId))) === 0;
    const insertValues = firstSave ? { ...values, dailyLimits: await stateCountsPerDay(tx, actor.facilityId) } : values;
    await tx
      .insert(retailSettings)
      .values({ facilityId: actor.facilityId, orgId: actor.orgId, ...insertValues })
      .onConflictDoUpdate({ target: retailSettings.facilityId, set: values });
    await audit(tx, actor, { entityType: "RetailSettings", entityId: actor.facilityId, action: "SAVE", after: values });
  });
}

const MAX_SHELF_PRICE = 100_000;

/** Put an item on this store's menu (or change it): its shelf price and how it counts toward purchase limits. */
export async function setMenuItem(
  actor: Actor,
  input: { itemId: string; price: unknown; limitCategory: string; limitPerUnit?: unknown },
): Promise<void> {
  const price = parsePrice(input.price, "Shelf price");
  if (price.lte(0)) throw new InventoryError("Shelf price must be more than zero.");
  if (price.decimalPlaces() > 2) throw new InventoryError("Shelf price can't have fractions of a cent.");
  if (price.gt(MAX_SHELF_PRICE)) throw new InventoryError(`Shelf price can't be more than $${MAX_SHELF_PRICE.toLocaleString("en-US")}.`);
  // KEEP (the form's default) changes only the price: a price change must never quietly drop an item's purchase limit.
  const keep = !input.limitCategory || input.limitCategory === "KEEP";
  if (!keep && !["NONE", "FLOWER", "CONCENTRATE", "EDIBLE"].includes(input.limitCategory)) throw new InventoryError("Choose how this item counts toward purchase limits.");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: items.id, name: items.name, limitCategory: items.limitCategory, limitPerUnit: items.limitPerUnit })
      .from(items)
      .where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId)))
      .for("update");
    if (!current) throw new InventoryError("Pick an item from the list.");
    const limitCategory = (keep ? current.limitCategory : input.limitCategory) as LimitCategory;
    const limitPerUnit = keep
      ? current.limitPerUnit
      : limitCategory === "NONE"
        ? null
        : store(parsePositiveQty(input.limitPerUnit, limitCategory === "EDIBLE" ? "Milligrams of THC per unit" : "Grams per unit"));
    if (!keep) await tx.update(items).set({ limitCategory, limitPerUnit }).where(eq(items.id, current.id));
    const item = current;
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
  // Same ceiling as promotions: New Mexico does not allow giving cannabis away free (APEX-18).
  const percent = parsePercent(input.percent, "Discount", MAX_PROMO_PERCENT);
  if (percent.lte(0)) throw new InventoryError("Discount must be more than zero.");
  await db.transaction(async (tx) => {
    // Names are matched ignoring capitals, so "veteran" and "Veteran" are the same discount.
    const [same] = await tx
      .select()
      .from(discountPresets)
      .where(and(eq(discountPresets.orgId, actor.orgId), sql`lower(${discountPresets.name}) = lower(${name})`))
      .for("update");
    if (same?.active) throw new InventoryError(`There is already a discount called ${same.name}.`);
    if (same) {
      // It was removed before: bring it back with the new percentage.
      await tx.update(discountPresets).set({ active: true, percent: percent.toFixed(3) }).where(eq(discountPresets.id, same.id));
      await audit(tx, actor, { entityType: "Discount", entityId: same.id, action: "RESTORE", after: { name: same.name, percent: percent.toString() } });
      return;
    }
    const [row] = await tx
      .insert(discountPresets)
      .values({ orgId: actor.orgId, name, percent: percent.toFixed(3) })
      .onConflictDoNothing({ target: [discountPresets.orgId, discountPresets.name] })
      .returning({ id: discountPresets.id });
    if (!row) throw new InventoryError(`There is already a discount called ${name}.`);
    await audit(tx, actor, { entityType: "Discount", entityId: row.id, action: "CREATE", after: { name, percent: percent.toString() } });
  });
}

/**
 * Take a discount off the store's list. It's switched off rather than deleted, so past sales and receipts
 * keep their record of it. Carts that already have it keep it; it can't be chosen for new ones.
 */
export async function removeDiscount(actor: Actor, input: { discountId: string }): Promise<string> {
  return db.transaction(async (tx) => {
    const [discount] = await tx
      .update(discountPresets)
      .set({ active: false })
      .where(and(eq(discountPresets.id, input.discountId), eq(discountPresets.orgId, actor.orgId), eq(discountPresets.active, true)))
      .returning();
    if (!discount) throw new InventoryError("That discount was not found. It may already be removed.");
    await audit(tx, actor, { entityType: "Discount", entityId: discount.id, action: "REMOVE", before: { name: discount.name, percent: discount.percent } });
    return discount.name;
  });
}

// ---------- Cash drawer ----------

/**
 * This person's open drawer at this store. Each person who rings sales counts their own drawer. A drawer
 * opened before drawers were per person (no owner recorded) is shared until it is closed.
 */
export async function lockOpenDrawer(tx: Tx, actor: Actor): Promise<DrawerSession | null> {
  const [session] = await tx
    .select()
    .from(drawerSessions)
    .where(
      and(
        eq(drawerSessions.orgId, actor.orgId),
        eq(drawerSessions.facilityId, actor.facilityId),
        eq(drawerSessions.status, "OPEN"),
        or(eq(drawerSessions.userId, actor.userId), isNull(drawerSessions.userId)),
      ),
    )
    .orderBy(sql`${drawerSessions.userId} is null`)
    .limit(1)
    .for("update");
  return session ?? null;
}

/** Every open drawer at this store, for managers. */
export async function openDrawers(tx: Tx | typeof db, actor: Pick<Actor, "orgId" | "facilityId">): Promise<DrawerSession[]> {
  return tx
    .select()
    .from(drawerSessions)
    .where(and(eq(drawerSessions.orgId, actor.orgId), eq(drawerSessions.facilityId, actor.facilityId), eq(drawerSessions.status, "OPEN")))
    .orderBy(drawerSessions.openedAt);
}

/** The open drawer this person rings into, if any. */
export async function myOpenDrawer(tx: Tx | typeof db, actor: Actor): Promise<DrawerSession | null> {
  const [own] = await tx
    .select()
    .from(drawerSessions)
    .where(
      and(
        eq(drawerSessions.orgId, actor.orgId),
        eq(drawerSessions.facilityId, actor.facilityId),
        eq(drawerSessions.status, "OPEN"),
        or(eq(drawerSessions.userId, actor.userId), isNull(drawerSessions.userId)),
      ),
    )
    .orderBy(sql`${drawerSessions.userId} is null`)
    .limit(1);
  return own ?? null;
}

export async function openDrawer(actor: Actor, input: { openingCash: unknown }): Promise<DrawerSession> {
  const openingCash = parseMoney(input.openingCash, "Opening cash", { allowZero: true });
  return db.transaction(async (tx) => {
    // Serialise drawer opening per person and store so a double tap cannot open two drawers.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`drawer:${actor.facilityId}:${actor.userId}`}))`);
    if (await lockOpenDrawer(tx, actor)) throw new InventoryError("Your drawer is already open at this store.");
    const [session] = await tx
      .insert(drawerSessions)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, userId: actor.userId, openingCash: openingCash.toFixed(2), openedByName: actor.userName })
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
  /** Cash handed back for returns from this drawer. */
  cashRefunds: Decimal;
  refundCount: number;
};

export async function drawerSummary(tx: Tx | typeof db, session: DrawerSession): Promise<DrawerSummary> {
  const rows = await tx.select().from(sales).where(eq(sales.drawerSessionId, session.id));
  const done = rows.filter((s) => s.status === "COMPLETED");
  const sum = (pick: (s: Sale) => string | null) => done.reduce((acc, s) => acc.add(pick(s) ?? 0), new Decimal(0));
  // Debit share of each sale. Older sales have no debit amount saved: all-debit or all-cash.
  const debitOf = (s: Sale) => new Decimal(s.debitAmount ?? (s.paymentMethod === "DEBIT" ? (s.total ?? 0) : 0));
  const cashKept = done.map((s) => new Decimal(s.total ?? 0).sub(debitOf(s)));
  const refunds = await tx
    .select({ amount: saleReturns.amount, cash: saleReturns.cashAmount })
    .from(saleReturns)
    .where(and(eq(saleReturns.drawerSessionId, session.id), inArray(saleReturns.refundMethod, ["CASH", "SPLIT"])));
  const cashRefunds = refunds.reduce((acc, r) => acc.add(r.cash ?? r.amount), new Decimal(0));
  return {
    cashRefunds,
    refundCount: refunds.length,
    saleCount: done.length,
    voidCount: rows.filter((s) => s.status === "VOIDED").length,
    subtotal: sum((s) => s.subtotal),
    discounts: sum((s) => s.discountTotal),
    exciseTax: sum((s) => s.exciseTax),
    salesTax: sum((s) => s.salesTax),
    total: sum((s) => s.total),
    cashTotal: cashKept.reduce((acc, v) => acc.add(v), new Decimal(0)),
    debitTotal: done.reduce((acc, s) => acc.add(debitOf(s)), new Decimal(0)),
    expectedCash: expectedCash(session.openingCash, cashKept).sub(cashRefunds),
  };
}

/**
 * Close a drawer with a cash count. Open carts must be finished or cancelled first. Without `drawerId` it is
 * the person's own drawer; a manager passes `drawerId` to close someone else's (the caller checks that role).
 */
export async function closeDrawer(actor: Actor, input: { countedCash: unknown; drawerId?: string }): Promise<{ id: string; variance: string }> {
  const counted = parseMoney(input.countedCash, "Counted cash", { allowZero: true });
  return db.transaction(async (tx) => {
    let session: DrawerSession | null;
    if (input.drawerId) {
      [session] = await tx
        .select()
        .from(drawerSessions)
        .where(
          and(
            eq(drawerSessions.id, input.drawerId),
            eq(drawerSessions.orgId, actor.orgId),
            eq(drawerSessions.facilityId, actor.facilityId),
            eq(drawerSessions.status, "OPEN"),
          ),
        )
        .for("update");
    } else {
      session = await lockOpenDrawer(tx, actor);
    }
    if (!session) throw new InventoryError("There is no open drawer to close.");
    // Empty carts (an ID was checked, nothing added) aren't shown on the register and hold nothing, so
    // closing cancels them. Carts with items must be finished or cancelled by a person first.
    const open = await tx
      .select({ id: sales.id, number: sales.number, lines: sql<number>`(select count(*)::int from sale_lines sl where sl.sale_id = "sales"."id")` })
      .from(sales)
      .where(and(eq(sales.drawerSessionId, session.id), eq(sales.status, "OPEN")))
      .for("update");
    const withItems = open.filter((c) => c.lines > 0);
    if (withItems.length > 0) {
      const names = withItems.map((c) => c.number).join(", ");
      const one = withItems.length === 1;
      const lead = `${one ? `Cart ${names} is` : `Carts ${names} are`} still open with items in ${one ? "it" : "them"}`;
      throw new InventoryError(
        session.userId && session.userId !== actor.userId
          ? `${lead} on ${session.openedByName}'s drawer. Ask them to finish or cancel ${one ? "it" : "them"}, or take ${one ? "it" : "them"} over from Held carts on your Register (it moves to your drawer), then close this drawer.`
          : `${lead}. Resume ${one ? "it" : "them"} from Held carts on the Register, then finish or cancel before closing the drawer.`,
      );
    }
    for (const empty of open) {
      await tx.update(sales).set({ status: "CANCELLED", completedAt: new Date() }).where(eq(sales.id, empty.id));
      await audit(tx, actor, { entityType: "Sale", entityId: empty.id, action: "CANCEL", reason: "Empty cart cancelled when the drawer closed" });
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
  input: { birthDate: string; idExpires: string; customerType: string; idNumber?: string },
): Promise<Sale> {
  return db.transaction((tx) => checkInInTx(tx, actor, input));
}

/** The check-in itself, for callers (like a pickup reservation) that must do more in the same transaction. */
export async function checkInInTx(
  tx: Tx,
  actor: Actor,
  input: { birthDate: string; idExpires: string; customerType: string; idNumber?: string },
): Promise<Sale> {
  if (input.customerType !== "ADULT_USE" && input.customerType !== "MEDICAL") throw new InventoryError("Choose adult-use or medical.");
  const customerType: CustomerType = input.customerType;
  const birthDate = parseDate(input.birthDate, "Date of birth");
  const idExpires = parseDate(input.idExpires, "ID expiry date");
  const settings = await getRetailSettings(tx, actor.facilityId);
  if (!settings.saved) {
    throw new InventoryError("This store's purchase limits and tax rates have not been entered yet. A manager must save them under Menu and store rules before anyone can sell.");
  }
  const pack = await storePack(tx, actor.facilityId);
  const ages = { adultMinAge: minimumAge(settings.adultMinAge, pack, "ADULT_USE"), medicalMinAge: minimumAge(settings.medicalMinAge, pack, "MEDICAL") };
  const problem = checkInProblem({ birthDate, idExpires, customerType }, ages, await facilityToday(actor.facilityId, tx));
  if (problem) throw new InventoryError(problem);
  const idNumber = (input.idNumber ?? "").trim();
  if (settings.dailyLimits && !idNumber)
    throw new InventoryError("This store counts purchase limits per customer per day. Enter the number from the customer's ID.");
  const customerKey = idNumber ? customerKeyFor(actor.orgId, idNumber) : null;
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
      customerKey,
      userId: actor.userId,
      userName: actor.userName,
    })
    .returning();
  await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "CHECK_IN", after: { number, customerType, idChecked: true, dailyLimits: Boolean(customerKey) } });
  return (await attachRewardsFromId(tx, actor, sale)) ?? sale;
}

/**
 * When the business recognizes shoppers by their ID scan, put a returning shopper's rewards account on the new
 * cart. Matches only the one-way fingerprint of the ID number, and only for a shopper who agreed to it when they joined.
 */
async function attachRewardsFromId(tx: Tx, actor: Actor, sale: Sale): Promise<Sale | null> {
  if (!sale.customerKey) return null;
  const program = await getProgram(tx, actor.orgId);
  if (!program.enabled || !program.idLookup) return null;
  const found = await findMemberByIdKey(tx, actor.orgId, sale.customerKey);
  if (!found) return null;
  const member = await expireIfIdle(tx, actor, await lockMember(tx, actor.orgId, found.id), program);
  const [updated] = await tx.update(sales).set({ rewardMemberId: member.id, rewardsUsed: 0 }).where(eq(sales.id, sale.id)).returning();
  await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "REWARDS_ATTACHED", after: { number: sale.number, memberId: member.id, byIdScan: true } });
  return updated;
}

async function lockSale(tx: Tx, actor: Actor, saleId: string, allowed: Sale["status"][], verb: string): Promise<Sale> {
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.orgId, actor.orgId), eq(sales.facilityId, actor.facilityId)))
    .for("update");
  if (!sale) throw new InventoryError("That sale was not found at this store.");
  if (!allowed.includes(sale.status)) throw new InventoryError(`Sale ${sale.number} is ${sale.status.toLowerCase()} and cannot be ${verb}.`);
  if (sale.status === "OPEN") return takeOverCart(tx, actor, sale);
  return sale;
}

/**
 * A cart belongs to the drawer it was started on. When someone else picks it up (a held cart resumed by another
 * budtender), it moves to their own open drawer first, so the cash they take lands in the till they'll count.
 */
async function takeOverCart(tx: Tx, actor: Actor, sale: Sale): Promise<Sale> {
  const mine = await lockOpenDrawer(tx, actor);
  if (mine && mine.id === sale.drawerSessionId) return sale;
  if (!mine) throw new InventoryError(`Cart ${sale.number} was started on ${sale.userName}'s drawer. Open your own drawer to take it over.`);
  const [moved] = await tx
    .update(sales)
    .set({ drawerSessionId: mine.id, userId: actor.userId, userName: actor.userName })
    .where(eq(sales.id, sale.id))
    .returning();
  await audit(tx, actor, {
    entityType: "Sale",
    entityId: sale.id,
    action: "TAKE_OVER",
    before: { number: sale.number, drawerSessionId: sale.drawerSessionId, servedBy: sale.userName },
    after: { number: sale.number, drawerSessionId: mine.id, servedBy: actor.userName },
  });
  return moved;
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
  returnable?: boolean;
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
      returnable: items.returnable,
    })
    .from(saleLines)
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(items.name));
}

export function saleTotals(
  lines: CartRow[],
  sale: Pick<Sale, "discountPercent" | "customerType"> & Partial<Pick<Sale, "rewardMemberId" | "rewardsUsed">>,
  settings: Awaited<ReturnType<typeof getRetailSettings>>,
  program?: RewardProgram | null,
  promoDiscount?: Decimal.Value,
): Totals & { rewardsApplied: number } {
  const options = {
    discountPercent: sale.discountPercent,
    exciseTaxPercent: settings.exciseTaxPercent,
    salesTaxPercent: settings.salesTaxPercent,
    taxExempt: sale.customerType === "MEDICAL" && settings.medicalTaxExempt,
    promoDiscount,
  };
  const before = cartTotals(lines, options);
  // Rewards the shopper chose, cut down to what fits this cart right now (a cart that shrank uses fewer).
  const rewardsApplied =
    program?.enabled && sale.rewardMemberId && (sale.rewardsUsed ?? 0) > 0 && !lines.some((l) => l.returnable) ? rewardsThatFit(sale.rewardsUsed ?? 0, before.subtotal.sub(before.promo).sub(before.discount), program) : 0;
  if (!rewardsApplied) return { ...before, rewardsApplied: 0 };
  return { ...cartTotals(lines, { ...options, rewardDiscount: new Decimal(program!.redeemDollars).mul(rewardsApplied) }), rewardsApplied };
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

/** A package's most recent lab result did not fail (no result counts as not failed). Failed product is never sold, in any state. */
// A failed result stands until a later PASS: a newer pending result doesn't make the package sellable again.
const notFailedLab = sql`coalesce((select lr.status::text from lab_results lr where lr.package_id = ${packages.id} and lr.status in ('PASS', 'FAIL') order by lr.created_at desc limit 1), '') <> 'FAIL'`;

/** Sellable stock of an item at this store: active packages, and only lab-passed ones where the state requires testing. */
async function inStock(tx: Tx, actor: Actor, itemId: string, pack: StatePack | null): Promise<{ sellable: Decimal; waitingOnLab: Decimal }> {
  const gate = requiresLabBeforeRetail(pack);
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${packages.quantity}), 0)`,
      passed: sql<string>`coalesce(sum(${packages.quantity}) filter (where ${passedLab}), 0)`,
    })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.itemId, itemId), eq(packages.status, "ACTIVE"), notFailedLab));
  const total = new Decimal(row.total);
  const sellable = gate ? new Decimal(row.passed) : total;
  return { sellable, waitingOnLab: total.sub(sellable) };
}

/** What the register can actually sell of each item at this store: the same rule a sale is checked against. */
export async function sellableByItem(tx: Tx | typeof db, actor: Pick<Actor, "orgId" | "facilityId">, pack: StatePack | null): Promise<Map<string, Decimal>> {
  const gate = requiresLabBeforeRetail(pack);
  const rows = await tx
    .select({
      itemId: packages.itemId,
      total: sql<string>`coalesce(sum(${packages.quantity}), 0)`,
      passed: sql<string>`coalesce(sum(${packages.quantity}) filter (where ${passedLab}), 0)`,
    })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.status, "ACTIVE"), notFailedLab))
    .groupBy(packages.itemId);
  return new Map(rows.map((r) => [r.itemId, new Decimal(gate ? r.passed : r.total)]));
}

/** Items with stock that exists but can't be sold yet because the state wants a passing lab result first. Lets the register say why a tile is greyed out. */
/**
 * Active packages in this store with no passing lab result (none yet, or only a pending one). In a state that requires a lab
 * result before retail these can't be sold, so the inventory page offers to hold them all at once. Failed ones are left alone:
 * a failed package is already blocked and belongs to a different process.
 */
export async function packagesWaitingOnLab(tx: Tx | typeof db, actor: Pick<Actor, "orgId" | "facilityId">): Promise<string[]> {
  const rows = await tx
    .select({ id: packages.id })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.status, "ACTIVE"), notFailedLab, sql`not coalesce(${passedLab}, false)`))
    .orderBy(asc(packages.id));
  return rows.map((r) => r.id);
}

export async function waitingOnLabByItem(tx: Tx | typeof db, actor: Pick<Actor, "orgId" | "facilityId">, pack: StatePack | null): Promise<Set<string>> {
  if (!requiresLabBeforeRetail(pack)) return new Set();
  const rows = await tx
    .select({
      itemId: packages.itemId,
      total: sql<string>`coalesce(sum(${packages.quantity}), 0)`,
      passed: sql<string>`coalesce(sum(${packages.quantity}) filter (where ${passedLab}), 0)`,
    })
    .from(packages)
    .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), eq(packages.status, "ACTIVE"), notFailedLab))
    .groupBy(packages.itemId);
  return new Set(rows.filter((r) => new Decimal(r.total).gt(r.passed)).map((r) => r.itemId));
}

/**
 * For daily limits: a keyed one-way fingerprint of a customer's ID number. The same ID gives the same
 * key at this business (and a different one at any other), and the number can't be worked back out.
 */
export function customerKeyFor(orgId: string, idNumber: string): string {
  const normalized = idNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 4) throw new InventoryError("Enter the full number from the customer's ID.");
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return createHmac("sha256", `customer-id:${secret}`).update(`${orgId}:${normalized}`).digest("hex");
}

type LimitLine = Parameters<typeof limitUsage>[0][number];

/** What this customer already bought today at completed sales anywhere in the business, for daily limits. */
export async function earlierToday(tx: Tx | typeof db, sale: Pick<Sale, "id" | "orgId" | "customerKey" | "facilityId">, day?: string): Promise<LimitLine[]> {
  // Whenever the customer's ID number is known, today's earlier purchases count: a second cart is not a fresh limit.
  if (!sale.customerKey) return [];
  // "Today" is the store's own day, in its state's time zone.
  const zone = await facilityZone(sale.facilityId, tx);
  return tx
    // Each line counts as it did when it was sold; only sales from before that was kept use the item's current numbers.
    .select({
      quantity: saleLines.quantity,
      limitCategory: sql<LimitCategory>`coalesce(${saleLines.limitCategory}, ${items.limitCategory})`,
      limitPerUnit: sql<string | null>`case when ${saleLines.limitCategory} is null then ${items.limitPerUnit} else ${saleLines.limitPerUnit} end`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .where(
      and(
        eq(sales.orgId, sale.orgId),
        eq(sales.customerKey, sale.customerKey),
        eq(sales.status, "COMPLETED"),
        sql`${sales.id} <> ${sale.id}`,
        sql`(${sales.completedAt} at time zone ${zone})::date = ${day ?? todayIn(zone)}::date`,
      ),
    );
}

/** The first purchase limit this cart breaks, using the stricter of the store's and the state's numbers. */
export function limitCheck(
  cart: Parameters<typeof limitUsage>[0],
  settings: Awaited<ReturnType<typeof getRetailSettings>>,
  pack: StatePack | null,
  customer: CustomerType,
  earlier: LimitLine[] = [],
) {
  const { limits, fromState } = effectiveLimits(limitsOf(settings), pack, customer);
  const lines = [...cart, ...earlier];
  const usage = limitUsage(lines);
  if (earlier.length) {
    // Daily limits: the same numbers, counted across today's purchases by this customer.
    const before = limitUsage(earlier);
    for (const k of ["FLOWER", "CONCENTRATE", "EDIBLE"] as const) {
      if (usage[k].gt(limits[k])) {
        const unit = k === "EDIBLE" ? "mg THC" : "g";
        const name = k === "EDIBLE" ? "edibles" : k.toLowerCase();
        return `This customer already bought ${before[k].toString()} ${unit} of ${name} earlier today. With this cart that's ${usage[k].toString()} ${unit}, over the daily limit of ${limits[k].toString()} ${unit}.`;
      }
    }
  }
  const problem = limitProblem(usage, limits);
  const together = combinedCap(pack, customer);
  if (!problem && pack && together && usage.FLOWER.add(usage.CONCENTRATE).gt(together)) {
    return `That puts the cart at ${usage.FLOWER.add(usage.CONCENTRATE).toString()} g of flower and concentrate together. ${pack.name} law allows ${together.toString()} g per purchase.`;
  }
  if (!problem || !pack) return problem;
  const broken = (["FLOWER", "CONCENTRATE", "EDIBLE"] as const).find((k) => usage[k].gt(limits[k]));
  return broken && fromState.has(broken) ? problem.replace(/The limit is (.+) per purchase\.$/, `${pack.name} law allows $1 per purchase.`) : problem;
}

/** Put a menu item in the cart at an exact quantity (zero takes it out), checking stock and purchase limits. */
export async function setItemQuantityInTx(tx: Tx, actor: Actor, sale: Sale, itemId: string, newQuantity: Decimal): Promise<string> {
  const [item] = await tx
    .select({ id: items.id, name: items.name, price: retailPrices.price, unit: items.unit })
    .from(items)
    .innerJoin(retailPrices, and(eq(retailPrices.itemId, items.id), eq(retailPrices.facilityId, actor.facilityId)))
    .where(and(eq(items.id, itemId), eq(items.orgId, actor.orgId), eq(items.active, true)));
  if (!item) throw new InventoryError("That item is not on this store's menu.");
  assertWholeForUnit(item.unit, newQuantity);
  const before = await cartLines(tx, sale.id);
  const existing = before.find((line) => line.itemId === item.id);
  if (newQuantity.lte(0)) {
    if (existing) {
      await tx.delete(saleLines).where(eq(saleLines.id, existing.id));
      await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "CART_LINE_REMOVED", before: { number: sale.number, item: item.name, quantity: existing.quantity, unitPrice: existing.unitPrice } });
    }
    return item.name;
  }
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
    // Taking quantity off a cart is the edit worth a record (it is how a ring-up gets quietly shortened); adding is not.
    if (newQuantity.lt(new Decimal(existing.quantity)))
      await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "CART_QUANTITY_REDUCED", before: { number: sale.number, item: item.name, quantity: existing.quantity }, after: { quantity: store(newQuantity) } });
  } else {
    await tx.insert(saleLines).values({ saleId: sale.id, itemId: item.id, quantity: store(newQuantity), unitPrice: item.price });
  }
  // An open cart follows the menu: when a price changed since a line was added, every line takes today's shelf
  // price on the next change, so one item never shows two prices.
  await tx.execute(sql`
    update sale_lines sl set unit_price = rp.price
    from retail_prices rp
    where sl.sale_id = ${sale.id} and rp.item_id = sl.item_id and rp.facility_id = ${actor.facilityId} and sl.unit_price <> rp.price`);
  const settings = await getRetailSettings(tx, actor.facilityId);
  const problem = limitCheck(await cartLines(tx, sale.id), settings, pack, sale.customerType, await earlierToday(tx, sale));
  if (problem) throw new InventoryError(problem);
  return item.name;
}

/** Add to the cart. Adding an item that is already there increases its quantity. */
export async function addToCart(actor: Actor, input: { saleId: string; itemId: string; quantity: unknown }): Promise<void> {
  const quantity = parsePositiveQty(input.quantity);
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    const [existing] = await tx
      .select({ quantity: saleLines.quantity })
      .from(saleLines)
      .where(and(eq(saleLines.saleId, sale.id), eq(saleLines.itemId, input.itemId)));
    await setItemQuantityInTx(tx, actor, sale, input.itemId, quantity.add(existing?.quantity ?? 0));
  });
}

/** Change how much of a cart line is being bought. Zero removes the line. */
export async function setLineQuantity(actor: Actor, input: { lineId: string; quantity: unknown }): Promise<void> {
  const text = String(input.quantity ?? "").trim();
  const quantity = text === "0" ? new Decimal(0) : parsePositiveQty(text);
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(saleLines).where(eq(saleLines.id, input.lineId));
    if (!line) throw new InventoryError("That line is no longer in the cart.");
    const sale = await lockSale(tx, actor, line.saleId, ["OPEN"], "changed");
    await setItemQuantityInTx(tx, actor, sale, line.itemId, quantity);
  });
}

/**
 * Add one unit of whatever a scanned barcode points to: a package tag at this store, or an item SKU.
 * Returns the item's name so the register can say what was added.
 */
export async function addScannedCode(actor: Actor, input: { saleId: string; code: string }): Promise<{ itemName: string }> {
  const code = input.code.trim();
  if (!code) throw new InventoryError("Scan or type a tag or SKU.");
  return db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    const [byTag] = await tx
      .select({ itemId: packages.itemId })
      .from(packages)
      .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), sql`upper(${packages.tag}) = upper(${code})`));
    const [bySku] = byTag
      ? [byTag]
      : await tx
          .select({ itemId: items.id })
          .from(items)
          .where(and(eq(items.orgId, actor.orgId), eq(items.active, true), sql`upper(${items.sku}) = upper(${code})`));
    if (!bySku) throw new InventoryError(`Nothing at this store matches "${code.slice(0, 40)}". Check the label, or search the menu by name.`);
    const [existing] = await tx
      .select({ quantity: saleLines.quantity })
      .from(saleLines)
      .where(and(eq(saleLines.saleId, sale.id), eq(saleLines.itemId, bySku.itemId)));
    const itemName = await setItemQuantityInTx(tx, actor, sale, bySku.itemId, new Decimal(1).add(existing?.quantity ?? 0));
    return { itemName };
  });
}

export async function removeFromCart(actor: Actor, input: { lineId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [line] = await tx.select().from(saleLines).where(eq(saleLines.id, input.lineId));
    if (!line) return;
    await lockSale(tx, actor, line.saleId, ["OPEN"], "changed");
    await tx.delete(saleLines).where(eq(saleLines.id, line.id));
    await audit(tx, actor, { entityType: "Sale", entityId: line.saleId, action: "CART_LINE_REMOVED", before: { item: line.itemId, quantity: line.quantity, unitPrice: line.unitPrice } });
  });
}

export async function setCartDiscount(actor: Actor, input: { saleId: string; discountId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    if (!input.discountId) {
      await tx.update(sales).set({ discountName: null, discountPercent: "0" }).where(eq(sales.id, sale.id));
      if (sale.discountName) {
        await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "DISCOUNT_REMOVED", before: { number: sale.number, name: sale.discountName, percent: sale.discountPercent } });
      }
      return;
    }
    const [discount] = await tx
      .select()
      .from(discountPresets)
      .where(and(eq(discountPresets.id, input.discountId), eq(discountPresets.orgId, actor.orgId), eq(discountPresets.active, true)));
    if (!discount) throw new InventoryError("Pick a discount from the list.");
    if (new Decimal(discount.percent).gt(MAX_PROMO_PERCENT)) throw new InventoryError(`${discount.name} takes more than ${MAX_PROMO_PERCENT}% off. New Mexico does not allow giving cannabis away free, so a manager needs to lower it.`);
    await tx.update(sales).set({ discountName: discount.name, discountPercent: discount.percent }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "DISCOUNT", after: { name: discount.name, percent: discount.percent } });
  });
}

/** Look a shopper up by phone and put them on this cart. Returns null when nobody has that number yet. */
export async function attachRewardsMember(actor: Actor, input: { saleId: string; phone: string }): Promise<{ firstName: string; points: number } | null> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new InventoryError("Type a 10-digit phone number, for example 505 555 0142.");
  return db.transaction(async (tx) => {
    const program = await getProgram(tx, actor.orgId);
    if (!program.enabled) throw new InventoryError("The rewards program is off. A manager can turn it on in Menu and store rules.");
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    const found = await findMemberByPhone(tx, actor.orgId, phone);
    if (!found) return null;
    const member = await expireIfIdle(tx, actor, await lockMember(tx, actor.orgId, found.id), program);
    await tx.update(sales).set({ rewardMemberId: member.id, rewardsUsed: 0 }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "REWARDS_ATTACHED", after: { number: sale.number, memberId: member.id } });
    return { firstName: member.firstName, points: member.points };
  });
}

/** Sign a shopper up at the counter (with their agreement) and put them on this cart. */
export async function joinRewards(
  actor: Actor,
  input: { saleId: string; phone: string; firstName: string; birthday?: string; agreed: unknown; email?: string; emailOk?: unknown; smsOk?: unknown; referralCode?: string },
): Promise<{ firstName: string; points: number }> {
  return db.transaction(async (tx) => {
    const program = await getProgram(tx, actor.orgId);
    if (!program.enabled) throw new InventoryError("The rewards program is off. A manager can turn it on in Menu and store rules.");
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    // Recognize them by this ID next time, when the business has that on and no one else already holds this ID.
    const idKey = program.idLookup && sale.customerKey && !(await findMemberByIdKey(tx, actor.orgId, sale.customerKey)) ? sale.customerKey : null;
    const member = await createMember(tx, actor, program, input, idKey);
    await tx.update(sales).set({ rewardMemberId: member.id, rewardsUsed: 0 }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "REWARDS_ATTACHED", after: { number: sale.number, memberId: member.id, joined: true, idLinked: Boolean(idKey) } });
    return { firstName: member.firstName, points: member.points };
  });
}

/** With the shopper's agreement, remember this cart's ID for the shopper on it, so their next ID scan finds their account. */
export async function linkIdToRewardsMember(actor: Actor, input: { saleId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const program = await getProgram(tx, actor.orgId);
    if (!program.enabled || !program.idLookup) throw new InventoryError("Finding shoppers by their ID scan is off. A manager can turn it on in Menu and store rules.");
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    if (!sale.customerKey) throw new InventoryError("This cart was started without an ID scan, so there's no ID to link.");
    if (!sale.rewardMemberId) throw new InventoryError("Add the shopper's rewards account to the cart first.");
    const member = await lockMember(tx, actor.orgId, sale.rewardMemberId);
    if (member.idKey) throw new InventoryError("This shopper's ID is already linked.");
    if (await findMemberByIdKey(tx, actor.orgId, sale.customerKey)) throw new InventoryError("This ID is already linked to a different rewards account.");
    await tx.update(rewardMembers).set({ idKey: sale.customerKey }).where(eq(rewardMembers.id, member.id));
    await audit(tx, actor, { entityType: "RewardsMember", entityId: member.id, action: "ID_LINKED", after: { agreed: true } });
  });
}

export async function detachRewardsMember(actor: Actor, input: { saleId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    await tx.update(sales).set({ rewardMemberId: null, rewardsUsed: 0 }).where(eq(sales.id, sale.id));
    if (sale.rewardMemberId)
      await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "REWARDS_DETACHED", before: { number: sale.number, memberId: sale.rewardMemberId, rewardsUsed: sale.rewardsUsed } });
  });
}

/** Choose how many rewards the shopper uses on this cart (0 for none). Must fit their points and the cart's cap. */
export async function setRewardsUsed(actor: Actor, input: { saleId: string; count: number }): Promise<void> {
  const count = Math.floor(Number(input.count));
  if (!Number.isFinite(count) || count < 0 || count > 1000) throw new InventoryError("Choose how many rewards to use.");
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "changed");
    if (!sale.rewardMemberId) throw new InventoryError("Add the shopper's rewards account to the cart first.");
    const program = await getProgram(tx, actor.orgId);
    if (!program.enabled) throw new InventoryError("The rewards program is off.");
    const member = await lockMember(tx, actor.orgId, sale.rewardMemberId);
    if (count * program.redeemPoints > member.points)
      throw new InventoryError(`${member.firstName} has ${member.points} points: enough for ${Math.floor(member.points / program.redeemPoints)} reward${Math.floor(member.points / program.redeemPoints) === 1 ? "" : "s"}.`);
    if (count > 0) {
      const lines = await cartLines(tx, sale.id);
      const takenBack = lines.find((l) => l.returnable);
      if (takenBack)
        throw new InventoryError(`Reward points can't pay for ${takenBack.itemName} because it can be returned. Take it out of the cart or don't use rewards on this sale.`);
      const settings = await getRetailSettings(tx, actor.facilityId);
      const promos = await cartPromos(tx, actor, lines);
      const before = saleTotals(lines, sale, settings, null, promos.total);
      const fit = rewardsThatFit(count, before.subtotal.sub(before.promo).sub(before.discount), program);
      if (fit < count)
        throw new InventoryError(
          fit === 0
            ? `Rewards can pay for at most ${program.maxSharePercent}% of a cart, and New Mexico doesn't allow free cannabis. Add more to the cart to use a reward.`
            : `Only ${fit} reward${fit === 1 ? "" : "s"} fit this cart: rewards can pay for at most ${program.maxSharePercent}% of it.`,
        );
    }
    await tx.update(sales).set({ rewardsUsed: count }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "REWARDS", after: { number: sale.number, rewardsUsed: count } });
  });
}

export async function cancelCart(actor: Actor, input: { saleId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "cancelled");
    await tx.update(sales).set({ status: "CANCELLED", completedAt: new Date() }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "CANCEL" });
  });
}

/**
 * Take each cart line's quantity from the oldest sellable packages, recording which packages it came from.
 * Returns the lines the shelf could not fully cover (empty when everything was found). A normal sale refuses
 * when anything is short; a sale rung up offline has already happened, so it keeps what was found and flags the rest.
 */
export async function takeSaleStock(
  tx: Tx,
  actor: Actor,
  saleNumber: string,
  lines: { id: string; itemId: string; itemName: string; quantity: Decimal.Value }[],
  labGate: boolean,
): Promise<{ itemName: string; found: Decimal; short: Decimal }[]> {
  const shortages: { itemName: string; found: Decimal; short: Decimal }[] = [];
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
          notFailedLab,
          labGate ? passedLab : undefined,
        ),
      )
      .orderBy(asc(packages.createdAt), asc(packages.id))
      .for("update");
    for (const candidate of candidates) {
      if (need.lte(0)) break;
      const take = Decimal.min(need, candidate.quantity);
      await consumeFromPackageInTx(tx, actor, { packageId: candidate.id, quantity: take, note: `Retail sale ${saleNumber}`, kind: "RETAIL_SALE" });
      await tx.insert(saleLinePackages).values({ saleLineId: line.id, packageId: candidate.id, quantity: store(take) });
      need = need.sub(take);
    }
    if (need.gt(0)) shortages.push({ itemName: line.itemName, found: new Decimal(line.quantity).sub(need), short: need });
  }
  return shortages;
}

/** Take payment. Stock comes out of the oldest packages first, and each package used is recorded. */
export async function completeSale(
  actor: Actor,
  input: { saleId: string; paymentMethod: string; cashTendered?: unknown; debitAmount?: unknown; cardLast4?: unknown; cardRef?: unknown },
): Promise<{ number: string; total: string; changeDue: string }> {
  if (!(SALE_PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) throw new InventoryError("Choose cash, debit, or split.");
  const method = input.paymentMethod as PaymentMethod;
  const card = cleanCardDetails(input);
  return db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor, input.saleId, ["OPEN"], "paid again");
    const [session] = await tx.select().from(drawerSessions).where(eq(drawerSessions.id, sale.drawerSessionId));
    if (session.status !== "OPEN") throw new InventoryError("This cart belongs to a drawer that has been closed. Cancel it and start a new one.");
    const lines = await cartLines(tx, sale.id);
    if (lines.length === 0) throw new InventoryError("The cart is empty.");
    const settings = await getRetailSettings(tx, actor.facilityId);
    const pack = await storePack(tx, actor.facilityId);
    // Lock out a second register finishing a sale for the same customer at the same moment.
    if (sale.customerKey) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daily:${sale.orgId}:${sale.customerKey}`}))`);
    const problem = limitCheck(lines, settings, pack, sale.customerType, await earlierToday(tx, sale));
    if (problem) throw new InventoryError(problem);
    const labGate = requiresLabBeforeRetail(pack);

    const program = sale.rewardMemberId ? await getProgram(tx, actor.orgId) : null;
    const promos = await cartPromos(tx, actor, lines);
    const totals = saleTotals(lines, sale, settings, program, promos.total);
    // Each discount layer is capped on its own, but they stack: promotion, cart discount and rewards together must still
    // leave the customer paying at least a tenth of the price, because New Mexico does not allow giving cannabis away (APEX-35).
    if (totals.subtotal.gt(0) && totals.taxable.lt(totals.subtotal.mul(100 - MAX_PROMO_PERCENT).div(100))) {
      throw new InventoryError(`These discounts together take more than ${MAX_PROMO_PERCENT}% off. New Mexico does not allow giving cannabis away free, so remove a discount or reward from this cart.`);
    }
    const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
    const settled = settlePayment(totals.total, method, {
      cashTendered: method === "DEBIT" || (blank(input.cashTendered) && totals.total.isZero()) ? null : parseMoney(input.cashTendered, "Cash handed over", { allowZero: true }),
      debit: method === "SPLIT" ? parseMoney(input.debitAmount, "Debit amount", { allowZero: true }) : null,
    });
    const change = settled.changeDue;

    const shortages = await takeSaleStock(tx, actor, sale.number, lines, labGate);
    if (shortages.length > 0) {
      throw new InventoryError(`${shortages[0].itemName} sold out while this cart was open. Only ${shortages[0].found.toString()} is left. Change the cart and try again.`);
    }

    const points = await settleSaleRewards(tx, actor, sale, {
      applied: totals.rewardsApplied,
      rewardDollars: totals.reward,
      paidBeforeTax: totals.taxable,
      today: await facilityToday(actor.facilityId, tx),
    });

    await tx
      .update(sales)
      .set({
        status: "COMPLETED",
        subtotal: totals.subtotal.toFixed(2),
        // Every dollar off, so subtotal - discount = what was taxed. The rewards part is also kept on its own.
        discountTotal: totals.promo.add(totals.discount).add(totals.reward).toFixed(2),
        promoDiscount: totals.promo.toFixed(2),
        promoNames: totals.promo.gt(0) ? promos.names.join(", ").slice(0, 300) : null,
        rewardsUsed: points ? totals.rewardsApplied : 0,
        rewardDiscount: points ? totals.reward.toFixed(2) : "0",
        pointsEarned: points?.earned ?? 0,
        exciseTax: totals.exciseTax.toFixed(2),
        salesTax: totals.salesTax.toFixed(2),
        total: totals.total.toFixed(2),
        paymentMethod: method,
        cashTendered: settled.cashTendered?.toFixed(2) ?? null,
        debitAmount: settled.debit.toFixed(2),
        // Card details only mean something when part of the sale went on a card.
        cardLast4: settled.debit.gt(0) ? card.cardLast4 : null,
        cardRef: settled.debit.gt(0) ? card.cardRef : null,
        changeDue: change.toFixed(2),
        completedAt: new Date(),
      })
      .where(eq(sales.id, sale.id));
    // Keep how each line counted toward purchase limits, so editing the item later can't rewrite this sale's count.
    for (const line of lines)
      await tx
        .update(saleLines)
        .set({ limitCategory: line.limitCategory, limitPerUnit: line.limitPerUnit, promoDiscount: (promos.byLine.get(line.id)?.amount ?? new Decimal(0)).toFixed(2) })
        .where(eq(saleLines.id, line.id));
    const perPromo = new Map<string, { name: string; lines: number; amount: Decimal }>();
    for (const hit of promos.byLine.values()) {
      const row = perPromo.get(hit.promoId) ?? { name: hit.promoName, lines: 0, amount: new Decimal(0) };
      row.lines += 1;
      row.amount = row.amount.add(hit.amount);
      perPromo.set(hit.promoId, row);
    }
    if (perPromo.size > 0)
      await tx.insert(salePromotions).values([...perPromo].map(([promoId, v]) => ({ orgId: actor.orgId, saleId: sale.id, promoId, promoName: v.name, lineCount: v.lines, amount: v.amount.toFixed(2) })));
    await audit(tx, actor, {
      entityType: "Sale",
      entityId: sale.id,
      action: "COMPLETE",
      after: {
        number: sale.number,
        total: totals.total.toFixed(2),
        paymentMethod: method,
        debit: settled.debit.toFixed(2),
        lines: lines.length,
        ...(points ? { rewardsUsed: totals.rewardsApplied, rewardDiscount: totals.reward.toFixed(2), pointsEarned: points.earned, birthdayBonus: points.birthday } : {}),
      },
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
    // A void undoes the whole sale. Once part of it has been returned, that part is already back (and refunded),
    // so voiding would restock it a second time: record the rest as a return instead.
    const [returned] = await tx.select({ number: saleReturns.number }).from(saleReturns).where(eq(saleReturns.saleId, sale.id)).limit(1);
    if (returned) {
      throw new InventoryError(`Sale ${sale.number} already has a return (${returned.number}), so it can't be voided. Record a return for the rest of it instead.`);
    }
    const taken = await tx
      .select({ packageId: saleLinePackages.packageId, quantity: saleLinePackages.quantity })
      .from(saleLinePackages)
      .innerJoin(saleLines, eq(saleLines.id, saleLinePackages.saleLineId))
      .where(eq(saleLines.saleId, sale.id))
      .orderBy(asc(saleLinePackages.packageId));
    for (const row of taken) {
      const before = await lockPackage(tx, actor, row.packageId);
      await returnToPackageInTx(tx, actor, {
        packageId: row.packageId,
        quantity: new Decimal(row.quantity),
        note: `Sale ${sale.number} voided: ${reason}`,
        auditAction: "RETURNED_FROM_VOIDED_SALE",
        type: "RETURN",
      });
      if (before.status === "ALLOCATED") {
        // The package was reserved for a wholesale order since this sale: the restocked units ship with it, so the
        // order's picked quantity grows too and the invoice bills what leaves (same rule as a return, APEX-17).
        const [alloc] = await tx.select().from(orderAllocations).where(eq(orderAllocations.packageId, row.packageId)).orderBy(desc(orderAllocations.quantity)).limit(1).for("update");
        if (alloc) await tx.update(orderAllocations).set({ quantity: store(new Decimal(alloc.quantity).add(new Decimal(row.quantity))) }).where(eq(orderAllocations.id, alloc.id));
      }
    }
    await reverseSaleRewards(tx, actor, sale);
    await tx.update(sales).set({ status: "VOIDED", voidReason: reason }).where(eq(sales.id, sale.id));
    await audit(tx, actor, { entityType: "Sale", entityId: sale.id, action: "VOID", after: { number: sale.number, total: sale.total }, reason });
  });
}

/** True when a moment is within the last few seconds or minutes, for "just paid" screens. */
export function happenedWithin(when: Date | null, ms: number): boolean {
  return Boolean(when) && Date.now() - when!.getTime() < ms;
}

/** The moment a given number of milliseconds ago. */
export function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

// ---------- Returns ----------

export const RETURN_DISPOSITIONS = ["RESTOCK", "DISPOSE"] as const;
export const REFUND_METHODS = ["CASH", "CARD", "SPLIT"] as const;

/** How a sale was paid: the cash and debit shares of its total. Older sales without a saved debit amount are all one or the other. */
export function tenderShares(sale: { paymentMethod: string | null; total: string | null; debitAmount: string | null }) {
  const total = new Decimal(sale.total ?? 0);
  const known = sale.debitAmount != null || sale.paymentMethod === "CASH" || sale.paymentMethod === "DEBIT";
  const debit = new Decimal(sale.debitAmount ?? (sale.paymentMethod === "DEBIT" ? total : 0));
  return { known, debit, cash: total.sub(debit) };
}

export type ReturnableLine = { saleLineId: string; itemName: string; unit: string; sold: string; returned: string; returnable: string; unitPrice: string; promoDiscount: string };

/** Each line of a sale with how much is still returnable. */
export async function returnableLines(tx: Tx | typeof db, saleId: string): Promise<ReturnableLine[]> {
  const rows = await tx
    .select({
      saleLineId: saleLines.id,
      itemName: items.name,
      unit: items.unit,
      sold: saleLines.quantity,
      unitPrice: saleLines.unitPrice,
      promoDiscount: saleLines.promoDiscount,
      returned: sql<string>`coalesce((select sum(${saleReturnLines.quantity}) from ${saleReturnLines} where ${saleReturnLines.saleLineId} = ${saleLines.id}), 0)`,
    })
    .from(saleLines)
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(items.name));
  return rows.map((r) => ({
    ...r,
    sold: new Decimal(r.sold).toString(),
    returned: new Decimal(r.returned).toString(),
    returnable: Decimal.max(new Decimal(r.sold).sub(r.returned), 0).toString(),
    unitPrice: new Decimal(r.unitPrice).toFixed(2),
    promoDiscount: new Decimal(r.promoDiscount).toFixed(2),
  }));
}

/**
 * Take items back from a completed sale, on any day. Sealed product goes back into the packages it was
 * sold from; opened or damaged product goes back and is then written off as damaged, so the ledger and
 * the state report both show what happened. The refund is the same share of what the customer paid
 * (after discount and tax) as the returned items were of the sale. Cash comes out of the person's open
 * drawer; card refunds are done on the card terminal and recorded here.
 */
export async function returnSale(
  actor: Actor,
  input: { saleId: string; lines: { saleLineId: string; quantity: unknown }[]; refundMethod: string; disposition: string; reason: string },
): Promise<{ number: string; amount: string }> {
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new InventoryError("Say why it's being returned. It goes in the audit trail.");
  if (!(REFUND_METHODS as readonly string[]).includes(input.refundMethod)) throw new InventoryError("Choose how the refund is given: the way the customer paid.");
  if (!(RETURN_DISPOSITIONS as readonly string[]).includes(input.disposition)) throw new InventoryError("Say whether the product is sealed (back to stock) or opened or damaged (written off).");
  const wanted = input.lines
    .map((l) => ({ saleLineId: String(l.saleLineId), raw: String(l.quantity ?? "").trim() }))
    .filter((l) => l.raw !== "" && l.raw !== "0");
  if (!wanted.length) throw new InventoryError("Enter how many of at least one item are coming back.");

  return atomically(async () => {
    return db.transaction(async (tx) => {
      const sale = await lockSale(tx, actor, input.saleId, ["COMPLETED"], "returned");
      const lines = await returnableLines(tx, sale.id);
      const [{ refunded }] = await tx
        .select({ refunded: sql<string>`coalesce(sum(${saleReturns.amount}), 0)` })
        .from(saleReturns)
        .where(eq(saleReturns.saleId, sale.id));
      // A refund goes back the way the customer paid (APEX-41): cash sales to cash, debit sales to the card, split sales
      // in the same cash and card shares they paid.
      const tender = tenderShares(sale);
      if (tender.known) {
        const expected = tender.debit.isZero() ? "CASH" : tender.cash.isZero() ? "CARD" : "SPLIT";
        if (input.refundMethod !== expected) {
          const words = { CASH: "cash", CARD: "back to their card", SPLIT: "in the same cash and card shares they paid" }[expected];
          throw new InventoryError(`This sale was paid ${expected === "SPLIT" ? "part cash and part debit" : expected === "CASH" ? "in cash" : "by debit"}, so the refund goes ${words}.`);
        }
      }
      let drawerId: string | null = null;
      if (input.refundMethod === "CASH" || input.refundMethod === "SPLIT") {
        const drawer = await lockOpenDrawer(tx, actor);
        if (!drawer) throw new InventoryError("Open your cash drawer to give the cash part of this refund.");
        drawerId = drawer.id;
      }

      // Work out the refund from the share of the sale coming back.
      let returnedValue = new Decimal(0);
      // Sales completed before lines kept their own promotion dollars fall back to the sale-wide average share.
      const linePromoKept = new Decimal(sale.promoDiscount ?? 0).isZero() || lines.some((l) => new Decimal(l.promoDiscount).gt(0));
      const plan: { line: ReturnableLine; quantity: Decimal }[] = [];
      for (const w of wanted) {
        const line = lines.find((l) => l.saleLineId === w.saleLineId);
        if (!line) throw new InventoryError("One of those items isn't on this sale.");
        const quantity = parsePositiveQty(w.raw, `Quantity of ${line.itemName}`);
        assertWholeForUnit(line.unit, quantity, `Quantity of ${line.itemName}`);
        if (quantity.gt(line.returnable))
          throw new InventoryError(`Only ${line.returnable} of ${line.itemName} can still be returned (${line.sold} sold, ${line.returned} already returned).`);
        plan.push({ line, quantity });
        // What the returned units were worth after the promotion their own line carried (APEX-13). The percent
        // discount, rewards dollars and tax were spread over the whole cart, so they follow this net value.
        returnedValue = returnedValue.add(quantity.mul(line.unitPrice).sub(linePromoKept ? new Decimal(line.promoDiscount).mul(quantity).div(line.sold) : 0));
      }
      const subtotal = new Decimal(sale.subtotal ?? 0).sub(linePromoKept ? (sale.promoDiscount ?? 0) : 0);
      const total = new Decimal(sale.total ?? 0);
      const remaining = total.sub(refunded);
      const everything = lines.every((l) => {
        const p = plan.find((x) => x.line.saleLineId === l.saleLineId);
        return new Decimal(l.returnable).eq(p?.quantity ?? 0);
      });
      // The last return gives back exactly what's left, so the pennies always add up to the sale total.
      const amount = everything ? remaining : Decimal.min(remaining, subtotal.isZero() ? new Decimal(0) : total.mul(returnedValue).div(subtotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));

      // Cash share of the refund. The last return gives back exactly the cash that is left, so cash and card never exceed what was paid.
      let cashAmount = input.refundMethod === "CASH" ? amount : new Decimal(0);
      if (input.refundMethod === "SPLIT") {
        const earlier = await tx.select({ method: saleReturns.refundMethod, amount: saleReturns.amount, cash: saleReturns.cashAmount }).from(saleReturns).where(eq(saleReturns.saleId, sale.id));
        const cashBack = earlier.reduce((acc, r) => acc.add(r.cash ?? (r.method === "CASH" ? r.amount : 0)), new Decimal(0));
        const proportional = total.isZero() ? new Decimal(0) : amount.mul(tender.cash).div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        cashAmount = Decimal.min(everything ? tender.cash.sub(cashBack) : proportional, amount, Decimal.max(tender.cash.sub(cashBack), 0));
      }

      const number = await nextNumber(tx, actor.facilityId, "R");
      const [ret] = await tx
        .insert(saleReturns)
        .values({
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          saleId: sale.id,
          number,
          refundMethod: input.refundMethod,
          drawerSessionId: drawerId,
          amount: amount.toFixed(2),
          cashAmount: cashAmount.toFixed(2),
          disposition: input.disposition,
          reason,
          userId: actor.userId,
          userName: actor.userName,
        })
        .returning();

      // Put the quantity back into the packages it was sold from, newest first.
      for (const { line, quantity } of plan) {
        const sources = await tx
          .select({ packageId: saleLinePackages.packageId, quantity: saleLinePackages.quantity })
          .from(saleLinePackages)
          .where(eq(saleLinePackages.saleLineId, line.saleLineId))
          .orderBy(asc(saleLinePackages.packageId));
        const already = await tx
          .select({ packageId: saleReturnLines.packageId, quantity: sql<string>`sum(${saleReturnLines.quantity})` })
          .from(saleReturnLines)
          .where(eq(saleReturnLines.saleLineId, line.saleLineId))
          .groupBy(saleReturnLines.packageId);
        let need = quantity;
        for (const src of sources.reverse()) {
          if (need.lte(0)) break;
          const back = new Decimal(already.find((a) => a.packageId === src.packageId)?.quantity ?? 0);
          const room = new Decimal(src.quantity).sub(back);
          if (room.lte(0)) continue;
          const take = Decimal.min(need, room);
          const before = await lockPackage(tx, actor, src.packageId);
          if (before.status === "DESTROYED") throw new InventoryError(`Package ${before.tag}, which ${line.itemName} came from, has been destroyed, so the return can't be recorded against it.`);
          if (before.status === "ALLOCATED" && input.disposition === "DISPOSE") {
            // Damaged product coming back into a package reserved for a wholesale order never joins that package, so it
            // cannot ship; the return is recorded and nothing is added to the reserved stock (APEX-17).
            await audit(tx, actor, { entityType: "Package", entityId: src.packageId, action: "RETURN_WRITTEN_OFF", after: { quantity: take.toString(), return: number }, reason: `Customer return ${number} not resellable: ${reason}` });
          } else {
            const after = await returnToPackageInTx(tx, actor, {
              packageId: src.packageId,
              quantity: take,
              note: `Return ${number} from sale ${sale.number}: ${reason}`,
              auditAction: "RETURNED_BY_CUSTOMER",
              type: "RETURN",
            });
            if (before.status === "ALLOCATED") {
              // Put back into a package reserved for a wholesale order, these units will ship with it: the order's picked
              // quantity grows with the package so the invoice bills exactly what leaves (APEX-17).
              const [alloc] = await tx.select().from(orderAllocations).where(eq(orderAllocations.packageId, src.packageId)).orderBy(desc(orderAllocations.quantity)).limit(1).for("update");
              if (alloc) await tx.update(orderAllocations).set({ quantity: store(new Decimal(alloc.quantity).add(take)) }).where(eq(orderAllocations.id, alloc.id));
            }
            if (input.disposition === "DISPOSE") {
              // Opened or damaged: written off straight away, so it can't be sold again.
              await adjustPackage(actor, {
                packageId: src.packageId,
                newQuantity: new Decimal(after.quantity).sub(take).toString(),
                reasonCode: "DAMAGE",
                note: `Customer return ${number} not resellable: ${reason}`,
                returnWriteOff: true,
              });
            }
          }
          await tx.insert(saleReturnLines).values({ returnId: ret.id, saleLineId: line.saleLineId, packageId: src.packageId, quantity: store(take) });
          need = need.sub(take);
        }
        if (need.gt(0)) throw new InventoryError(`The packages ${line.itemName} was sold from can't take back ${need.toString()} more.`);
      }

      await takeBackForReturn(tx, actor, sale, amount, everything, number);

      await audit(tx, actor, {
        entityType: "Sale",
        entityId: sale.id,
        action: "RETURN",
        after: {
          number: sale.number,
          return: number,
          refund: amount.toFixed(2),
          refundMethod: input.refundMethod,
          disposition: input.disposition,
          items: plan.map((p) => `${p.quantity.toString()} × ${p.line.itemName}`),
        },
        reason,
      });
      return { number, amount: amount.toFixed(2) };
    });
  });
}

export async function returnsForSale(saleId: string) {
  return db.select().from(saleReturns).where(eq(saleReturns.saleId, saleId)).orderBy(asc(saleReturns.createdAt));
}
