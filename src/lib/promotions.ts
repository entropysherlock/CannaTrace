import Decimal from "decimal.js";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  itemCategories,
  items,
  promotions,
  salePromotions,
  sales,
} from "@/db/schema";
import { InventoryError, audit, type Actor } from "@/lib/inventory";
import {
  MAX_PROMO_PERCENT,
  WEEKDAY_NAMES,
  applyPromotions,
  parseClock,
  type Promo,
  type PromoResult,
  type StoreClock,
} from "@/lib/promotions-math";
import { facilityZone } from "@/lib/time";

type Reader = Pick<typeof db, "select">;

export function rowToPromo(r: typeof promotions.$inferSelect): Promo {
  return {
    id: r.id,
    name: r.name,
    kind:
      r.kind === "DOLLAR" || r.kind === "BOGO" || r.kind === "BUNDLE"
        ? r.kind
        : "PERCENT",
    buyQty: r.buyQty,
    getQty: r.getQty,
    amount: r.amount,
    scope:
      r.scope === "ITEM" ? "ITEM" : r.scope === "CATEGORY" ? "CATEGORY" : "ALL",
    categoryId: r.categoryId,
    itemId: r.itemId,
    weekdays: r.weekdays,
    startTime: r.startTime,
    endTime: r.endTime,
    startDate: r.startDate,
    endDate: r.endDate,
    active: r.active,
  };
}

export async function listPromotions(
  reader: Reader,
  orgId: string,
  onlyActive = false,
) {
  return reader
    .select()
    .from(promotions)
    .where(
      onlyActive
        ? and(eq(promotions.orgId, orgId), eq(promotions.active, true))
        : eq(promotions.orgId, orgId),
    )
    .orderBy(asc(promotions.name));
}

/** The weekday, minutes since midnight and date at a store right now (or at `at`). */
export async function storeClock(
  facilityId: string,
  reader: Reader = db,
  at = new Date(),
): Promise<StoreClock> {
  const zone = await facilityZone(facilityId, reader as typeof db);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday,
    ),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const NONE: PromoResult = {
  total: new Decimal(0),
  byLine: new Map(),
  names: [],
};

/** What the running promotions take off this cart. */
export async function cartPromos(
  reader: Reader,
  ctx: { orgId: string; facilityId: string },
  lines: { id: string; itemId: string; quantity: string; unitPrice: string }[],
): Promise<PromoResult> {
  if (lines.length === 0) return NONE;
  const rows = await listPromotions(reader, ctx.orgId, true);
  if (rows.length === 0) return NONE;
  const cats = await reader
    .select({ id: items.id, categoryId: items.categoryId })
    .from(items)
    .where(eq(items.orgId, ctx.orgId));
  const catOf = new Map(cats.map((c) => [c.id, c.categoryId]));
  return applyPromotions(
    lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      categoryId: catOf.get(l.itemId) ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
    rows.map(rowToPromo),
    await storeClock(ctx.facilityId, reader),
  );
}

// ---------- Managing promotions ----------

const text = (v: unknown) => String(v ?? "").trim();

export type PromoInput = Record<
  string,
  FormDataEntryValue | FormDataEntryValue[] | undefined
>;

/** Check what a manager typed and turn it into a row. Throws a plain-language InventoryError. */
export function parsePromoInput(
  raw: { [k: string]: unknown },
  weekdayValues: string[],
) {
  const name = text(raw.name).slice(0, 80);
  if (!name)
    throw new InventoryError(
      "Give the promotion a name, such as Wax Wednesday.",
    );
  const kindText = text(raw.kind);
  const kind =
    kindText === "DOLLAR" || kindText === "BOGO" || kindText === "BUNDLE"
      ? kindText
      : "PERCENT";
  const count = (v: unknown, what: string, fallback: number) => {
    const t = text(v);
    if (!t) return fallback;
    if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 10)
      throw new InventoryError(`${what} must be a whole number from 1 to 10.`);
    return Number(t);
  };
  const buyQty =
    kind === "BOGO"
      ? count(raw.buyQty, "How many to buy", 1)
      : kind === "BUNDLE"
        ? count(raw.buyQty, "How many in the bundle", 2)
        : null;
  const getQty =
    kind === "BOGO" ? count(raw.getQty, "How many are discounted", 1) : null;
  if (kind === "BUNDLE" && buyQty! < 2)
    throw new InventoryError("A bundle needs at least 2 items.");
  const amountText = text(raw.amount).replace(/^\$/, "").replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(amountText))
    throw new InventoryError(
      kind === "PERCENT" || kind === "BOGO"
        ? "Percent off must be a number such as 20."
        : kind === "BUNDLE"
          ? "The bundle price must be an amount such as 60."
          : "Dollars off must be an amount such as 5 or 2.50.",
    );
  const amount = new Decimal(amountText);
  if (amount.lte(0))
    throw new InventoryError("The amount off must be more than zero.");
  if ((kind === "PERCENT" || kind === "BOGO") && amount.gt(MAX_PROMO_PERCENT))
    throw new InventoryError(
      `Percent off can be at most ${MAX_PROMO_PERCENT}%. New Mexico doesn't allow giving cannabis away free, so something is always charged.`,
    );
  const scope =
    text(raw.scope) === "ITEM"
      ? "ITEM"
      : text(raw.scope) === "CATEGORY"
        ? "CATEGORY"
        : "ALL";
  const categoryId = scope === "CATEGORY" ? text(raw.categoryId) : "";
  const itemId = scope === "ITEM" ? text(raw.itemId) : "";
  if (scope === "CATEGORY" && !categoryId)
    throw new InventoryError("Pick which category the promotion is for.");
  if (scope === "ITEM" && !itemId)
    throw new InventoryError("Pick which product the promotion is for.");
  const weekdays = [...new Set(weekdayValues.map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort();
  const startTime = text(raw.startTime);
  const endTime = text(raw.endTime);
  if (startTime && parseClock(startTime) === null)
    throw new InventoryError("Start time must look like 16:20.");
  if (endTime && parseClock(endTime) === null)
    throw new InventoryError("End time must look like 19:00.");
  if ((startTime && !endTime) || (!startTime && endTime)) {
    // One-sided windows are allowed ("from 4:20 PM"), so nothing to reject here.
  }
  const startDate = text(raw.startDate);
  const endDate = text(raw.endDate);
  for (const d of [startDate, endDate])
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d))
      throw new InventoryError("Dates must be real dates.");
  if (startDate && endDate && endDate < startDate)
    throw new InventoryError("The end date is before the start date.");
  return {
    name,
    kind,
    buyQty,
    getQty,
    amount: amount.toFixed(2),
    scope,
    categoryId: categoryId || null,
    itemId: itemId || null,
    weekdays,
    startTime: startTime || null,
    endTime: endTime || null,
    startDate: startDate || null,
    endDate: endDate || null,
  };
}

export async function createPromotion(
  actor: Actor,
  raw: { [k: string]: unknown },
  weekdayValues: string[],
) {
  const v = parsePromoInput(raw, weekdayValues);
  return db.transaction(async (tx) => {
    if (v.categoryId) {
      const [c] = await tx
        .select({ id: itemCategories.id })
        .from(itemCategories)
        .where(
          and(
            eq(itemCategories.id, v.categoryId),
            eq(itemCategories.orgId, actor.orgId),
          ),
        );
      if (!c) throw new InventoryError("That category isn't on your menu.");
    }
    if (v.itemId) {
      const [i] = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, v.itemId), eq(items.orgId, actor.orgId)));
      if (!i) throw new InventoryError("That product isn't on your menu.");
    }
    const [row] = await tx
      .insert(promotions)
      .values({ orgId: actor.orgId, ...v })
      .returning();
    await audit(tx, actor, {
      entityType: "Promotion",
      entityId: row.id,
      action: "CREATE",
      after: {
        name: v.name,
        kind: v.kind,
        amount: v.amount,
        scope: v.scope,
        weekdays: v.weekdays.map((d) => WEEKDAY_NAMES[d]),
      },
    });
    return row;
  });
}

export async function setPromotionActive(
  actor: Actor,
  id: string,
  active: boolean,
) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(promotions)
      .set({ active })
      .where(and(eq(promotions.id, id), eq(promotions.orgId, actor.orgId)))
      .returning();
    if (!row) throw new InventoryError("That promotion no longer exists.");
    await audit(tx, actor, {
      entityType: "Promotion",
      entityId: id,
      action: active ? "ENABLE" : "DISABLE",
      after: { name: row.name },
    });
  });
}

export async function deletePromotion(actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(promotions)
      .where(and(eq(promotions.id, id), eq(promotions.orgId, actor.orgId)))
      .returning();
    if (row)
      await audit(tx, actor, {
        entityType: "Promotion",
        entityId: id,
        action: "DELETE",
        before: { name: row.name },
      });
  });
}

/** What each promotion did over the last `days` days, from completed (not voided) sales. */
export async function promotionResults(
  reader: Reader,
  orgId: string,
  days = 30,
) {
  const rows = await reader
    .select({
      promoId: salePromotions.promoId,
      name: sql<string>`max(${salePromotions.promoName})`,
      sales: sql<number>`count(distinct ${salePromotions.saleId})::int`,
      lines: sql<number>`coalesce(sum(${salePromotions.lineCount}), 0)::int`,
      discount: sql<string>`coalesce(sum(${salePromotions.amount}), 0)::text`,
      salesTotal: sql<string>`coalesce(sum(${sales.total}), 0)::text`,
    })
    .from(salePromotions)
    .innerJoin(sales, eq(sales.id, salePromotions.saleId))
    .where(
      and(
        eq(salePromotions.orgId, orgId),
        eq(sales.status, "COMPLETED"),
        sql`${sales.completedAt} >= now() - (${days} * interval '1 day')`,
      ),
    )
    .groupBy(salePromotions.promoId)
    .orderBy(sql`sum(${salePromotions.amount}) desc`);
  return rows;
}
