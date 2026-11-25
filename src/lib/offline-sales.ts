import Decimal from "decimal.js";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { discountPresets, drawerSessions, items, retailPrices, saleLines, sales, users } from "@/db/schema";
import { db } from "./db";
import { InventoryError, audit, type Actor } from "./inventory";
import type { OfflineSale, OfflineSyncResult } from "./offline-types";
import { nextNumber } from "./numbering";
import { cartTotals, checkInProblem } from "./pos-math";
import { getRetailSettings, limitCheck, lockOpenDrawer, storePack, takeSaleStock } from "./pos";
import { minimumAge, requiresLabBeforeRetail } from "./rules";
import { facilityZone } from "./time";

const MAX_AGE_DAYS = 14;
const MAX_LINES = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const dec = (value: unknown, what: string): Decimal => {
  try {
    const d = new Decimal(String(value ?? "").trim());
    if (d.isFinite()) return d;
  } catch {
    /* falls through */
  }
  throw new InventoryError(`${what} is not a number.`);
};
const money = (value: unknown, what: string) => {
  const d = dec(value, what);
  if (d.lt(0) || d.gt(1_000_000)) throw new InventoryError(`${what} is out of range.`);
  return d.toDecimalPlaces(2);
};

const CLASSES = ["NONE", "FLOWER", "CONCENTRATE", "EDIBLE"] as const;
const isUuid = (v: unknown) => typeof v === "string" && UUID.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, what: string, max: number) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new InventoryError(`${what} is not readable.`);
  return v.slice(0, max);
};
const percent = (v: unknown, what: string) => {
  if (typeof v !== "string" && typeof v !== "number") throw new InventoryError(`${what} is not a number.`);
  const d = dec(v, what);
  if (d.lt(0) || d.gt(100) || d.decimalPlaces() > 3) throw new InventoryError(`${what} is out of range.`);
  return d;
};

/** Day of a moment in the store's own time zone, as YYYY-MM-DD. */
const dayIn = (when: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);

/**
 * Record a cash sale that was rung up on a register with no internet. The customer has already paid and left,
 * so this never refuses a sale over what it cannot verify: it records it and writes down what a manager should
 * check (a price that changed, an ID or limit problem, stock that turns out to be short). Only a sale that is
 * malformed, too old, for another store, or has no open drawer to land in is turned away, and the register keeps it
 * to try again. Sending the same sale twice never records it twice.
 */
export async function recordOfflineSale(actor: Actor, input: OfflineSale): Promise<OfflineSyncResult> {
  if (!input || typeof input !== "object") throw new InventoryError("That offline sale was not readable.");
  if (!isUuid(input.offlineId)) throw new InventoryError("That offline sale has no valid id.");
  if (input.facilityId !== actor.facilityId) throw new InventoryError("This offline sale was rung up at a different store. Switch to that store, then sync again.");
  if (input.customerType !== "ADULT_USE" && input.customerType !== "MEDICAL") throw new InventoryError("That offline sale has no customer type.");
  const realDate = (v: unknown) => typeof v === "string" && DATE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!realDate(input.birthDate) || !realDate(input.idExpires)) throw new InventoryError("That offline sale has unreadable ID dates.");
  if (typeof input.soldAt !== "string") throw new InventoryError("That offline sale has no valid time.");
  const soldAt = new Date(input.soldAt);
  if (Number.isNaN(soldAt.getTime())) throw new InventoryError("That offline sale has no valid time.");
  const now = Date.now();
  if (soldAt.getTime() > now + 10 * 60_000) throw new InventoryError("That offline sale is dated in the future. Check the device's clock.");
  if (now - soldAt.getTime() > MAX_AGE_DAYS * 86_400_000) throw new InventoryError(`That offline sale is more than ${MAX_AGE_DAYS} days old, so it cannot be added automatically. Ask a manager to record it by hand.`);
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > MAX_LINES) throw new InventoryError("That offline sale has no items.");

  // Same item twice becomes one line; every number must be a clean decimal.
  const wanted = new Map<string, { quantity: Decimal; price: Decimal; name: string }>();
  const claimed = new Map<string, { limitCategory: (typeof CLASSES)[number] | null; limitPerUnit: string | null }>();
  for (const line of input.lines) {
    if (!isObj(line) || !isUuid(line.itemId)) throw new InventoryError("That offline sale has an item that does not exist in this business.");
    if (typeof line.quantity !== "string" && typeof line.quantity !== "number") throw new InventoryError("That offline sale has an item with an impossible quantity.");
    if (typeof line.unitPrice !== "string" && typeof line.unitPrice !== "number") throw new InventoryError("A price is not a number.");
    const quantity = dec(line.quantity, "Quantity");
    if (quantity.lte(0) || quantity.gt(10_000)) throw new InventoryError("That offline sale has an item with an impossible quantity.");
    const price = money(line.unitPrice, "A price");
    const itemId = line.itemId;
    const before = wanted.get(itemId);
    if (before && !before.price.eq(price)) throw new InventoryError("That offline sale has the same item at two prices.");
    wanted.set(itemId, { quantity: (before?.quantity ?? new Decimal(0)).add(quantity), price, name: text(line.name, "An item name", 120) });
    if (line.limitCategory !== undefined && !CLASSES.includes(line.limitCategory as never)) throw new InventoryError("That offline sale has an unknown purchase-limit class.");
    if (line.limitPerUnit !== undefined && line.limitPerUnit !== null) dec(line.limitPerUnit, "A limit amount");
    claimed.set(itemId, { limitCategory: line.limitCategory ?? null, limitPerUnit: line.limitPerUnit == null ? null : String(line.limitPerUnit) });
  }
  if (input.discount !== null && input.discount !== undefined && !isObj(input.discount)) throw new InventoryError("That offline sale has an unreadable discount.");
  const discountName = input.discount ? text(input.discount.name, "The discount name", 60) : "";
  let discountPercent = new Decimal(0);
  if (input.discount) {
    try {
      discountPercent = percent(input.discount.percent, "The discount");
    } catch {
      throw new InventoryError("That offline sale has an impossible discount.");
    }
  }
  let charged: { excise: Decimal; sales: Decimal; exempt: boolean } | null = null;
  if (input.rates !== undefined && input.rates !== null) {
    if (!isObj(input.rates) || typeof input.rates.medicalTaxExempt !== "boolean") throw new InventoryError("That offline sale has unreadable tax rates.");
    charged = { excise: percent(input.rates.exciseTaxPercent, "The excise tax rate"), sales: percent(input.rates.salesTaxPercent, "The sales tax rate"), exempt: input.rates.medicalTaxExempt };
  }
  if (input.drawerId !== null && input.drawerId !== undefined && !isUuid(input.drawerId)) throw new InventoryError("That offline sale has an unreadable drawer.");
  if (!isUuid(input.sellerId)) throw new InventoryError("That offline sale has an unreadable seller.");
  const cashTendered = money(input.cashTendered, "Cash handed over");
  const clientTotal = money(input.total, "The total");

  return db.transaction(async (tx) => {
    const [seen] = await tx.select({ id: sales.id, number: sales.number, reviewNote: sales.reviewNote }).from(sales).where(and(eq(sales.facilityId, actor.facilityId), eq(sales.offlineId, input.offlineId)));
    if (seen) return { saleId: seen.id, number: seen.number, flagged: seen.reviewNote !== null, duplicate: true };

    const settings = await getRetailSettings(tx, actor.facilityId);
    if (!settings.saved) throw new InventoryError("This store's purchase limits and tax rates are not set, so offline sales cannot be added yet. A manager must set them under Menu and store rules.");
    const pack = await storePack(tx, actor.facilityId);
    const zone = await facilityZone(actor.facilityId, tx);
    const notes: string[] = [];

    // Which drawer the cash went into: the one it was rung up on if that is still open, else the person syncing.
    let drawerId: string | null = null;
    if (input.drawerId) {
      const [d] = await tx
        .select({ id: drawerSessions.id })
        .from(drawerSessions)
        .where(and(eq(drawerSessions.id, String(input.drawerId)), eq(drawerSessions.orgId, actor.orgId), eq(drawerSessions.facilityId, actor.facilityId), eq(drawerSessions.status, "OPEN")))
        .for("update");
      drawerId = d?.id ?? null;
    }
    if (!drawerId) {
      const mine = await lockOpenDrawer(tx, actor);
      if (!mine) throw new InventoryError("Open your cash drawer, then sync again. The cash from this sale needs a drawer to count into.");
      drawerId = mine.id;
      if (input.drawerId && input.drawerId !== mine.id) notes.push("The drawer it was rung up on is closed, so the cash was counted into the drawer that synced it. Check that drawer's count.");
    }

    // Items: each must still exist in this business; the price charged is what the customer paid.
    const ids = [...wanted.keys()];
    const found = await tx
      .select({ id: items.id, name: items.name, active: items.active, limitCategory: items.limitCategory, limitPerUnit: items.limitPerUnit, menuPrice: retailPrices.price })
      .from(items)
      .leftJoin(retailPrices, and(eq(retailPrices.itemId, items.id), eq(retailPrices.facilityId, actor.facilityId)))
      .where(and(eq(items.orgId, actor.orgId), inArray(items.id, ids)));
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const id of ids) if (!byId.has(id)) throw new InventoryError("That offline sale has an item that does not exist in this business.");
    const rows = ids.map((id) => {
      const item = byId.get(id)!;
      const w = wanted.get(id)!;
      if (!item.active || item.menuPrice === null) notes.push(`${item.name} is no longer on this store's menu.`);
      else if (!new Decimal(item.menuPrice).eq(w.price)) notes.push(`${item.name} was sold at $${w.price.toFixed(2)}; the menu price now is $${new Decimal(item.menuPrice).toFixed(2)}.`);
      // The limit class the register sold it under, else the one it has now.
      const c = claimed.get(id);
      const limitCategory = c?.limitCategory ?? item.limitCategory;
      const limitPerUnit = c?.limitCategory ? (limitCategory === "NONE" ? null : c.limitPerUnit ?? item.limitPerUnit) : item.limitPerUnit;
      // A register can be wrong or tampered with, so the limit CHECK never trusts a looser class than the server's own:
      // it uses the item's current class unless that is NONE and the register reported a real one.
      const useClaim = c?.limitCategory && c.limitCategory !== item.limitCategory;
      if (useClaim) notes.push(`${item.name} was sold as a ${c!.limitCategory} item but is a ${item.limitCategory} item now; check the purchase limit by hand.`);
      const checkWithClaim = useClaim && item.limitCategory === "NONE";
      return {
        itemId: id, name: item.name, quantity: w.quantity, price: w.price, limitCategory, limitPerUnit,
        checkCategory: checkWithClaim ? limitCategory : item.limitCategory, checkPerUnit: checkWithClaim ? limitPerUnit : item.limitPerUnit,
      };
    });

    // Discount: honoured as given, but a manager should see one that is not on the current list.
    if (input.discount && discountPercent.gt(0)) {
      const presets = await tx.select({ name: discountPresets.name, percent: discountPresets.percent }).from(discountPresets).where(and(eq(discountPresets.orgId, actor.orgId), eq(discountPresets.active, true)));
      if (!presets.some((p) => p.name === discountName && new Decimal(p.percent).eq(discountPercent))) {
        notes.push(`The ${discountPercent.toString()}% discount "${discountName}" is not on the current discount list.`);
      }
    }

    const totals = cartTotals(
      rows.map((r) => ({ quantity: r.quantity, unitPrice: r.price })),
      {
        discountPercent,
        // The customer was charged at the rates the register showed; booking at today's rates would misstate tax owed.
        exciseTaxPercent: charged ? charged.excise : settings.exciseTaxPercent,
        salesTaxPercent: charged ? charged.sales : settings.salesTaxPercent,
        taxExempt: input.customerType === "MEDICAL" && (charged ? charged.exempt : settings.medicalTaxExempt),
      },
    );
    if (charged && (!charged.excise.eq(settings.exciseTaxPercent) || !charged.sales.eq(settings.salesTaxPercent) || charged.exempt !== settings.medicalTaxExempt)) {
      notes.push(`Tax rates changed since this sale was rung up; it was booked at the rates the customer was charged (${charged.excise.toString()}% excise, ${charged.sales.toString()}% sales).`);
    }
    if (!totals.total.eq(clientTotal)) notes.push(`The receipt showed $${clientTotal.toFixed(2)} but ${charged ? "the rates it was charged at" : "today's tax rates"} make it $${totals.total.toFixed(2)}.`);
    if (cashTendered.lt(totals.total)) notes.push(`Cash handed over ($${cashTendered.toFixed(2)}) is less than the total ($${totals.total.toFixed(2)}).`);
    const change = Decimal.max(0, cashTendered.sub(totals.total));

    // The checks the register would have made, re-run as of the moment of sale.
    const soldDay = dayIn(soldAt, zone);
    const idProblem = checkInProblem(
      { birthDate: input.birthDate, idExpires: input.idExpires, customerType: input.customerType },
      { adultMinAge: minimumAge(settings.adultMinAge, pack, "ADULT_USE"), medicalMinAge: minimumAge(settings.medicalMinAge, pack, "MEDICAL") },
      soldDay,
    );
    if (idProblem) notes.push(`ID check: ${idProblem}`);
    const limitProblem = limitCheck(
      rows.map((r) => ({ quantity: r.quantity, limitCategory: r.checkCategory, limitPerUnit: r.checkPerUnit })),
      settings,
      pack,
      input.customerType,
    );
    if (limitProblem) notes.push(`Purchase limit: ${limitProblem}`);
    if (settings.dailyLimits) notes.push("This store counts limits per customer per day. That could not be checked offline; look for earlier purchases by this customer that day.");

    // The seller named on the sale, when they really are on this business's team.
    const [seller] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, String(input.sellerId)), eq(users.orgId, actor.orgId)));
    const number = await nextNumber(tx, actor.facilityId, "S");
    const [sale] = await tx
      .insert(sales)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        drawerSessionId: drawerId,
        number,
        status: "COMPLETED",
        customerType: input.customerType,
        discountName: input.discount && discountPercent.gt(0) ? discountName : null,
        discountPercent: discountPercent.toString(),
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discount.toFixed(2),
        exciseTax: totals.exciseTax.toFixed(2),
        salesTax: totals.salesTax.toFixed(2),
        total: totals.total.toFixed(2),
        paymentMethod: "CASH",
        cashTendered: cashTendered.toFixed(2),
        debitAmount: "0.00",
        changeDue: change.toFixed(2),
        offlineId: input.offlineId,
        userId: seller?.id ?? actor.userId,
        userName: seller?.name ?? actor.userName,
        createdAt: soldAt,
        completedAt: soldAt,
      })
      .returning();
    const lines = await tx
      .insert(saleLines)
      .values(rows.map((r) => ({ saleId: sale.id, itemId: r.itemId, quantity: r.quantity.toFixed(4), unitPrice: r.price.toFixed(4), limitCategory: r.limitCategory, limitPerUnit: r.limitPerUnit })))
      .returning();
    const nameOf = new Map(rows.map((r) => [r.itemId, r.name]));
    const shortages = await takeSaleStock(
      tx,
      actor,
      number,
      lines.map((l) => ({ id: l.id, itemId: l.itemId, itemName: nameOf.get(l.itemId) ?? "Item", quantity: l.quantity })),
      requiresLabBeforeRetail(pack),
    );
    for (const s of shortages) notes.push(`Not enough stock: ${s.itemName} was short by ${s.short.toString()}. Check the count and adjust inventory.`);

    const reviewNote = notes.length ? notes.join(" ") : null;
    if (reviewNote) await tx.update(sales).set({ reviewNote }).where(eq(sales.id, sale.id));
    await audit(tx, actor, {
      entityType: "Sale",
      entityId: sale.id,
      action: "OFFLINE_SYNC",
      after: { number, localNumber: String(input.localNumber ?? "").slice(0, 20), soldAt: soldAt.toISOString(), total: totals.total.toFixed(2), flags: notes.length },
    });
    return { saleId: sale.id, number, flagged: notes.length > 0, duplicate: false };
  });
}

export type ReviewRow = { id: string; number: string; total: string | null; soldAt: Date | null; sellerName: string; reviewNote: string; reviewedAt: Date | null; reviewedBy: string | null };

/** Offline sales a manager should look at: the ones with something noted, newest reviewed ones after. */
export async function reviewQueue(actor: Pick<Actor, "orgId" | "facilityId">): Promise<ReviewRow[]> {
  const rows = await db
    .select({ id: sales.id, number: sales.number, total: sales.total, soldAt: sales.completedAt, sellerName: sales.userName, reviewNote: sales.reviewNote, reviewedAt: sales.reviewedAt, reviewedBy: sales.reviewedBy })
    .from(sales)
    .where(and(eq(sales.orgId, actor.orgId), eq(sales.facilityId, actor.facilityId), isNotNull(sales.reviewNote), sql`(${sales.reviewedAt} is null or ${sales.reviewedAt} > now() - interval '7 days')`))
    .orderBy(sql`${sales.reviewedAt} is not null`, asc(sales.completedAt));
  return rows.map((r) => ({ ...r, reviewNote: r.reviewNote ?? "" }));
}

export async function reviewCount(facilityId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sales).where(and(eq(sales.facilityId, facilityId), isNotNull(sales.reviewNote), isNull(sales.reviewedAt)));
  return row?.n ?? 0;
}

/** A manager has looked into an offline sale's flags. Nothing about the sale changes; the note stays. */
export async function markReviewed(actor: Actor, input: { saleId: string; note?: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: sales.id, number: sales.number, reviewNote: sales.reviewNote, reviewedAt: sales.reviewedAt })
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.orgId, actor.orgId), eq(sales.facilityId, actor.facilityId)))
      .for("update");
    if (!row || row.reviewNote === null) throw new InventoryError("That sale has nothing to review at this store.");
    if (row.reviewedAt) throw new InventoryError(`${row.number} was already reviewed.`);
    await tx.update(sales).set({ reviewedAt: new Date(), reviewedBy: actor.userName }).where(eq(sales.id, row.id));
    await audit(tx, actor, { entityType: "Sale", entityId: row.id, action: "REVIEWED", before: { number: row.number, flags: row.reviewNote }, reason: input.note?.trim() || null });
  });
}
