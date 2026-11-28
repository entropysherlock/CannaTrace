import Decimal from "decimal.js";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { pricedOnly } from "@/lib/menu-price";
import { menuImageFor } from "@/lib/menu-images";
import { facilities, itemCategories, items, onlineMenus, organizations, reservationLines, reservations, retailPrices } from "@/db/schema";
import { db } from "./db";
import { InventoryError, audit, type Actor } from "./inventory";
import { assertWholeForUnit, parsePositiveQty } from "./inventory-math";
import { nextNumber } from "./numbering";
import { checkInInTx, getRetailSettings, sellableByItem, setItemQuantityInTx, storePack } from "./pos";
import { unitLabel } from "./units";

/** Web address names: lower case letters, digits and dashes, 3 to 40 characters, no dash at either end. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set(["admin", "api", "app", "login", "demo", "signup", "pricing", "setup", "support", "www"]);

export function normalizeSlug(input: unknown): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const MAX_OPEN_PER_PHONE = 3;
export const MAX_PER_STORE_PER_HOUR = 40;
const MAX_LINES = 30;
const MAX_QTY_PER_LINE = 100;

export type MenuSettings = { enabled: boolean; slug: string; takeReservations: boolean; welcome: string | null; pickupNote: string | null };

export async function getMenuSettings(facilityId: string): Promise<MenuSettings | null> {
  const [row] = await db.select().from(onlineMenus).where(eq(onlineMenus.facilityId, facilityId));
  return row ? { enabled: row.enabled, slug: row.slug, takeReservations: row.takeReservations, welcome: row.welcome, pickupNote: row.pickupNote } : null;
}

const words = (v: unknown, what: string, max: number) => {
  const t = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (t.length > max) throw new InventoryError(`${what} is too long (${max} characters at most).`);
  return t || null;
};

/** A manager turns the store's public menu on or off and sets its address and wording. */
export async function saveMenuSettings(actor: Actor, input: { enabled: boolean; slug: unknown; takeReservations: boolean; welcome?: unknown; pickupNote?: unknown }): Promise<void> {
  const slug = normalizeSlug(input.slug);
  if (!SLUG_RE.test(slug)) throw new InventoryError("The menu address must be 3 to 40 letters, numbers or dashes, for example sandia-storefront.");
  if (RESERVED.has(slug)) throw new InventoryError("That address is reserved. Choose another.");
  const values = {
    enabled: input.enabled,
    slug,
    takeReservations: input.takeReservations,
    welcome: words(input.welcome, "The welcome message", 400),
    pickupNote: words(input.pickupNote, "The pickup note", 400),
    updatedAt: new Date(),
  };
  if (input.enabled) {
    const settings = await getRetailSettings(db, actor.facilityId);
    if (!settings.saved) throw new InventoryError("Save this store's purchase limits and tax rates first, then turn the online menu on.");
  }
  await db.transaction(async (tx) => {
    const [taken] = await tx.select({ facilityId: onlineMenus.facilityId }).from(onlineMenus).where(eq(onlineMenus.slug, slug));
    if (taken && taken.facilityId !== actor.facilityId) throw new InventoryError("Another store already uses that address. Choose another.");
    await tx
      .insert(onlineMenus)
      .values({ facilityId: actor.facilityId, orgId: actor.orgId, ...values })
      .onConflictDoUpdate({ target: onlineMenus.facilityId, set: values });
    await audit(tx, actor, { entityType: "OnlineMenu", entityId: actor.facilityId, action: "SAVE", after: { enabled: values.enabled, slug, takeReservations: values.takeReservations } });
  });
}

/** thc and cbd are percents from the newest passing lab test on stock that's for sale here, when there is one. */
export type PublicMenuItem = { id: string; name: string; strain: string | null; unit: string; unitLabel: string; price: string; whole: boolean; thc: string | null; cbd: string | null; image: string | null };
export type PublicMenu = {
  slug: string;
  storeName: string;
  businessName: string;
  welcome: string | null;
  pickupNote: string | null;
  takeReservations: boolean;
  categories: { name: string; items: PublicMenuItem[] }[];
};

/**
 * What the public sees: the items the register could sell right now (on the shelf menu, in stock, passing the
 * state's lab rule) at shelf prices. Never stock counts, costs, package tags or lab data.
 */
export async function publicMenu(slug: string): Promise<PublicMenu | null> {
  const clean = normalizeSlug(slug);
  const [menu] = await db.select().from(onlineMenus).where(and(eq(onlineMenus.slug, clean), eq(onlineMenus.enabled, true)));
  if (!menu) return null;
  const [facility] = await db.select({ name: facilities.name, active: facilities.active, orgId: facilities.orgId }).from(facilities).where(eq(facilities.id, menu.facilityId));
  if (!facility || !facility.active) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, facility.orgId));
  const pack = await storePack(db, menu.facilityId);
  const stock = await sellableByItem(db, { orgId: menu.orgId, facilityId: menu.facilityId }, pack);
  const rows = await db
    .select({ id: items.id, name: items.name, strain: items.strain, unit: items.unit, price: retailPrices.price, category: itemCategories.name })
    .from(retailPrices)
    .innerJoin(items, eq(items.id, retailPrices.itemId))
    .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(and(eq(retailPrices.facilityId, menu.facilityId), eq(items.active, true), pricedOnly()))
    .orderBy(asc(itemCategories.name), asc(items.name));
  const potency = await potencyByItem(menu.orgId, menu.facilityId);
  const byCategory = new Map<string, PublicMenuItem[]>();
  for (const r of rows) {
    if (!(stock.get(r.id) ?? new Decimal(0)).gt(0)) continue;
    const list = byCategory.get(r.category) ?? [];
    list.push({ id: r.id, name: r.name, strain: r.strain, unit: r.unit, unitLabel: unitLabel(r.unit), price: new Decimal(r.price).toFixed(2), whole: r.unit === "EACH", thc: potency.get(r.id)?.thc ?? null, cbd: potency.get(r.id)?.cbd ?? null, image: menuImageFor(r.name) });
    byCategory.set(r.category, list);
  }
  return {
    slug: clean,
    storeName: facility.name,
    businessName: org?.name ?? facility.name,
    welcome: menu.welcome,
    pickupNote: menu.pickupNote,
    takeReservations: menu.takeReservations,
    categories: [...byCategory].map(([name, list]) => ({ name, items: list })),
  };
}

/** Per item: the newest passing lab result's THC and CBD percents among its in-stock packages at this store. */
async function potencyByItem(orgId: string, facilityId: string): Promise<Map<string, { thc: string | null; cbd: string | null }>> {
  const result = await db.execute<{ item_id: string; thc: string | null; cbd: string | null }>(sql`
    select distinct on (p.item_id) p.item_id as item_id, lr.thc_percent as thc, lr.cbd_percent as cbd
    from packages p
    join lab_results lr on lr.package_id = p.id and lr.status = 'PASS'
    where p.org_id = ${orgId} and p.facility_id = ${facilityId} and p.status = 'ACTIVE' and p.quantity > 0
    order by p.item_id, lr.created_at desc`);
  const rows = result.rows;
  const pct = (v: string | null) => (v === null || v === undefined || !new Decimal(v).gt(0) ? null : new Decimal(v).toDecimalPlaces(1).toString());
  return new Map(rows.map((row) => [row.item_id, { thc: pct(row.thc), cbd: pct(row.cbd) }]));
}

export function cleanPhone(input: unknown): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) throw new InventoryError("Enter a 10-digit phone number so the store can reach you.");
  return national;
}

/**
 * A visitor reserves items for pickup. Nothing leaves stock: the store checks ID and rings the sale up at
 * the register, where stock and purchase limits are checked again. Open to anyone, so it is limited per
 * phone number and per store, and only for people who say they are of age.
 */
export async function createReservation(
  slug: string,
  input: { name: unknown; phone: unknown; note?: unknown; adult: unknown; lines: { itemId: string; quantity: unknown }[]; website?: unknown },
): Promise<{ id: string; number: string }> {
  // A hidden field only automated form-fillers complete: pretend it worked.
  if (String(input.website ?? "").trim()) return { id: "ignored", number: "PU-00000" };
  if (input.adult !== true) throw new InventoryError("Please confirm you are 21 or older.");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) throw new InventoryError("Enter your name (60 characters at most).");
  const phone = cleanPhone(input.phone);
  const note = words(input.note, "The note", 300);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new InventoryError("Add at least one item to your reservation.");
  if (input.lines.length > MAX_LINES) throw new InventoryError(`A reservation can hold up to ${MAX_LINES} different items.`);
  const wanted = new Map<string, Decimal>();
  for (const line of input.lines) {
    const q = parsePositiveQty(line.quantity, "Quantity");
    if (q.gt(MAX_QTY_PER_LINE)) throw new InventoryError(`Reserve ${MAX_QTY_PER_LINE} or fewer of one item. For more, call the store.`);
    wanted.set(line.itemId, (wanted.get(line.itemId) ?? new Decimal(0)).add(q));
  }

  return db.transaction(async (tx) => {
    const [menu] = await tx.select().from(onlineMenus).where(and(eq(onlineMenus.slug, normalizeSlug(slug)), eq(onlineMenus.enabled, true))).for("update");
    if (!menu || !menu.takeReservations) throw new InventoryError("This store is not taking online reservations right now.");
    const hourAgo = sql`now() - interval '1 hour'`;
    const [{ n: recent }] = await tx.select({ n: sql<number>`count(*)::int` }).from(reservations).where(and(eq(reservations.facilityId, menu.facilityId), gt(reservations.createdAt, hourAgo)));
    if (recent >= MAX_PER_STORE_PER_HOUR) throw new InventoryError("The store has a lot of reservations right now. Please call the store or try again later.");
    const [{ n: open }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reservations)
      .where(and(eq(reservations.facilityId, menu.facilityId), eq(reservations.phone, phone), inArray(reservations.status, ["NEW", "READY"])));
    if (open >= MAX_OPEN_PER_PHONE) throw new InventoryError("You already have open reservations at this store. Pick those up first, or call the store.");

    const pack = await storePack(tx, menu.facilityId);
    const stock = await sellableByItem(tx, { orgId: menu.orgId, facilityId: menu.facilityId }, pack);
    const ids = [...wanted.keys()];
    const priced = await tx
      .select({ id: items.id, name: items.name, unit: items.unit, price: retailPrices.price })
      .from(retailPrices)
      .innerJoin(items, eq(items.id, retailPrices.itemId))
      .where(and(eq(retailPrices.facilityId, menu.facilityId), eq(items.active, true), pricedOnly(), inArray(items.id, ids)));
    const byId = new Map(priced.map((p) => [p.id, p]));
    for (const [itemId, qty] of wanted) {
      const item = byId.get(itemId);
      if (!item) throw new InventoryError("One of those items is no longer on the menu. Refresh the page and try again.");
      assertWholeForUnit(item.unit, qty, `Quantity of ${item.name}`);
      const have = stock.get(itemId) ?? new Decimal(0);
      if (qty.gt(have)) throw new InventoryError(have.lte(0) ? `${item.name} just sold out.` : `Sorry, there is not enough ${item.name} for that. Try a smaller amount.`);
    }
    const number = await nextNumber(tx, menu.facilityId, "PU");
    const [row] = await tx.insert(reservations).values({ orgId: menu.orgId, facilityId: menu.facilityId, number, customerName: name, phone, note }).returning();
    await tx.insert(reservationLines).values([...wanted].map(([itemId, qty]) => ({ reservationId: row.id, itemId, quantity: qty.toFixed(4), unitPrice: byId.get(itemId)!.price })));
    return { id: row.id, number };
  });
}

export type ReservationView = {
  id: string;
  number: string;
  status: string;
  customerName: string;
  phone: string;
  note: string | null;
  createdAt: Date;
  saleId: string | null;
  lines: { itemId: string; name: string; unit: string; quantity: string; unitPrice: string; inStock: string }[];
};

async function withLines(facilityId: string, orgId: string, rows: (typeof reservations.$inferSelect)[]): Promise<ReservationView[]> {
  if (rows.length === 0) return [];
  const lines = await db
    .select({ reservationId: reservationLines.reservationId, itemId: reservationLines.itemId, name: items.name, unit: items.unit, quantity: reservationLines.quantity, unitPrice: reservationLines.unitPrice })
    .from(reservationLines)
    .innerJoin(items, eq(items.id, reservationLines.itemId))
    .where(inArray(reservationLines.reservationId, rows.map((r) => r.id)))
    .orderBy(asc(items.name));
  const stock = await sellableByItem(db, { orgId, facilityId }, await storePack(db, facilityId));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    customerName: r.customerName,
    phone: r.phone,
    note: r.note,
    createdAt: r.createdAt,
    saleId: r.saleId,
    lines: lines.filter((l) => l.reservationId === r.id).map((l) => ({ itemId: l.itemId, name: l.name, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, inStock: (stock.get(l.itemId) ?? new Decimal(0)).toString() })),
  }));
}

/** The store's pickup queue: waiting and bagged reservations, plus ones opened at the register in the last day. */
export async function pickupQueue(actor: Pick<Actor, "orgId" | "facilityId">): Promise<ReservationView[]> {
  const rows = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.facilityId, actor.facilityId),
        eq(reservations.orgId, actor.orgId),
        sql`(${reservations.status} in ('NEW','READY') or (${reservations.status} in ('IN_SALE','CANCELLED') and ${reservations.updatedAt} > now() - interval '1 day'))`,
      ),
    )
    .orderBy(asc(reservations.createdAt));
  return withLines(actor.facilityId, actor.orgId, rows);
}

export async function waitingCount(facilityId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(reservations).where(and(eq(reservations.facilityId, facilityId), inArray(reservations.status, ["NEW", "READY"])));
  return row?.n ?? 0;
}

/** What the visitor sees after reserving: their own reservation, found by its long private id. */
export async function publicReservation(slug: string, id: string) {
  const [menu] = await db.select().from(onlineMenus).where(eq(onlineMenus.slug, normalizeSlug(slug)));
  if (!menu) return null;
  const [row] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.facilityId, menu.facilityId)));
  if (!row) return null;
  const [facility] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, menu.facilityId));
  const lines = await db
    .select({ name: items.name, unit: items.unit, quantity: reservationLines.quantity, unitPrice: reservationLines.unitPrice })
    .from(reservationLines)
    .innerJoin(items, eq(items.id, reservationLines.itemId))
    .where(eq(reservationLines.reservationId, row.id))
    .orderBy(asc(items.name));
  return { number: row.number, status: row.status, firstName: row.customerName.split(" ")[0], storeName: facility?.name ?? "", pickupNote: menu.pickupNote, slug: menu.slug, lines };
}

/** Staff mark a reservation bagged and ready, or cancel it (the customer's own phone call, a no-show, sold out). */
export async function setReservationStatus(actor: Actor, input: { id: string; status: string; reason?: string }): Promise<void> {
  if (input.status !== "READY" && input.status !== "CANCELLED" && input.status !== "NEW") throw new InventoryError("Choose ready, cancel or back to waiting.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, input.id), eq(reservations.orgId, actor.orgId), eq(reservations.facilityId, actor.facilityId)))
      .for("update");
    if (!row) throw new InventoryError("That reservation was not found at this store.");
    if (row.status === "IN_SALE") throw new InventoryError(`${row.number} is already open at the register.`);
    if (row.status === "CANCELLED") throw new InventoryError(`${row.number} was cancelled.`);
    await tx.update(reservations).set({ status: input.status, handledBy: actor.userName, updatedAt: new Date() }).where(eq(reservations.id, row.id));
    await audit(tx, actor, { entityType: "Reservation", entityId: row.id, action: input.status, before: { number: row.number, status: row.status }, after: { number: row.number, status: input.status }, reason: input.reason?.trim() || null });
  });
}

/**
 * The customer arrived: check their ID and open a cart with the reserved items. Anything that can't go in
 * (sold out since, or over a purchase limit) is left out and listed, so the budtender can talk it through.
 */
export async function startSaleFromReservation(
  actor: Actor,
  input: { id: string; birthDate: string; idExpires: string; customerType: string; idNumber?: string },
): Promise<{ saleId: string; left: string[] }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, input.id), eq(reservations.orgId, actor.orgId), eq(reservations.facilityId, actor.facilityId)))
      .for("update");
    if (!row) throw new InventoryError("That reservation was not found at this store.");
    if (row.status === "IN_SALE") throw new InventoryError(`${row.number} is already open at the register.`);
    if (row.status === "CANCELLED") throw new InventoryError(`${row.number} was cancelled.`);
    const sale = await checkInInTx(tx, actor, input);
    const lines = await tx
      .select({ itemId: reservationLines.itemId, name: items.name, quantity: reservationLines.quantity })
      .from(reservationLines)
      .innerJoin(items, eq(items.id, reservationLines.itemId))
      .where(eq(reservationLines.reservationId, row.id))
      .orderBy(desc(reservationLines.quantity));
    const left: string[] = [];
    for (const line of lines) {
      try {
        // Each line in its own savepoint: one that can't be added must not undo the others.
        await tx.transaction((sp) => setItemQuantityInTx(sp, actor, sale, line.itemId, new Decimal(line.quantity)));
      } catch (error) {
        if (!(error instanceof InventoryError)) throw error;
        left.push(`${line.name}: ${error.message}`);
      }
    }
    await tx.update(reservations).set({ status: "IN_SALE", saleId: sale.id, handledBy: actor.userName, updatedAt: new Date() }).where(eq(reservations.id, row.id));
    await audit(tx, actor, { entityType: "Reservation", entityId: row.id, action: "OPEN_SALE", after: { number: row.number, saleNumber: sale.number, notAdded: left.length } });
    return { saleId: sale.id, left };
  });
}
