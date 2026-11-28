import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { pricedOnly } from "@/lib/menu-price";
import { discountPresets, facilities, itemCategories, items, retailPrices } from "@/db/schema";
import { db } from "./db";
import type { Actor } from "./inventory";
import type { OfflineLimits, OfflineSnapshot } from "./offline-types";
import { getRetailSettings, myOpenDrawer, sellableByItem, storePack } from "./pos";
import { combinedCap, effectiveLimits, minimumAge } from "./rules";
import { facilityZone } from "./time";
import { unitLabel } from "./units";

/** What the offline register needs, worked out the same way the online register works it out. */
export async function buildOfflineSnapshot(actor: Actor): Promise<OfflineSnapshot | null> {
  const settings = await getRetailSettings(db, actor.facilityId);
  // A store that never entered its limits and tax rates cannot sell, online or off.
  if (!settings.saved) return null;
  const [facility] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, actor.facilityId));
  if (!facility) return null;
  const pack = await storePack(db, actor.facilityId);
  const [stock, drawer, timeZone] = await Promise.all([sellableByItem(db, actor, pack), myOpenDrawer(db, actor), facilityZone(actor.facilityId)]);
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      unit: items.unit,
      category: itemCategories.name,
      price: retailPrices.price,
      limitCategory: items.limitCategory,
      limitPerUnit: items.limitPerUnit,
    })
    .from(retailPrices)
    .innerJoin(items, eq(items.id, retailPrices.itemId))
    .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(and(eq(retailPrices.facilityId, actor.facilityId), eq(items.active, true), pricedOnly()))
    .orderBy(asc(itemCategories.name), asc(items.name));
  const presets = await db
    .select({ id: discountPresets.id, name: discountPresets.name, percent: discountPresets.percent })
    .from(discountPresets)
    .where(and(eq(discountPresets.orgId, actor.orgId), eq(discountPresets.active, true)))
    .orderBy(asc(discountPresets.name));

  const store = { FLOWER: new Decimal(settings.flowerLimitGrams), CONCENTRATE: new Decimal(settings.concentrateLimitGrams), EDIBLE: new Decimal(settings.edibleLimitMg) };
  const limitsFor = (customer: "ADULT_USE" | "MEDICAL"): OfflineLimits => {
    const { limits } = effectiveLimits(store, pack, customer);
    const together = combinedCap(pack, customer);
    return { FLOWER: limits.FLOWER.toString(), CONCENTRATE: limits.CONCENTRATE.toString(), EDIBLE: limits.EDIBLE.toString(), combined: together ? together.toString() : null };
  };

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    facilityId: actor.facilityId,
    facilityName: facility.name,
    timeZone,
    userId: actor.userId,
    userName: actor.userName,
    drawerId: drawer?.id ?? null,
    settings: {
      exciseTaxPercent: new Decimal(settings.exciseTaxPercent).toString(),
      salesTaxPercent: new Decimal(settings.salesTaxPercent).toString(),
      medicalTaxExempt: settings.medicalTaxExempt,
      adultMinAge: minimumAge(settings.adultMinAge, pack, "ADULT_USE"),
      medicalMinAge: minimumAge(settings.medicalMinAge, pack, "MEDICAL"),
      dailyLimits: settings.dailyLimits,
    },
    limits: { ADULT_USE: limitsFor("ADULT_USE"), MEDICAL: limitsFor("MEDICAL") },
    stateName: pack?.name ?? null,
    menu: rows.map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      category: r.category ?? "Other",
      unit: r.unit,
      unitLabel: unitLabel(r.unit),
      price: new Decimal(r.price).toFixed(2),
      limitCategory: r.limitCategory,
      limitPerUnit: r.limitPerUnit === null ? null : new Decimal(r.limitPerUnit).toString(),
      stock: (stock.get(r.id) ?? new Decimal(0)).toString(),
    })),
    discounts: presets.map((d) => ({ id: d.id, name: d.name, percent: new Decimal(d.percent).toString() })),
    receiptWarning: settings.receiptWarning ?? null,
  };
}
