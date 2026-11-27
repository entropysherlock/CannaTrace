import { and, count, eq, sql } from "drizzle-orm";
import { discountPresets, drawerSessions, facilities, locations, packages, retailPrices, retailSettings, rewardSettings } from "@/db/schema";
import { db } from "@/lib/db";
import { packFor, requiresLabBeforeRetail } from "@/lib/rules";

/** One step in getting a retail store ready to sell. `required` steps block selling; the rest are worth doing but optional. */
export type SetupStep = { key: string; title: string; detail: string; href: string; done: boolean; required: boolean };

/**
 * Where a retail store stands on being ready for its first sale, in the order a new owner should do things.
 * Returns null for a store that isn't a retailer, so cultivators never see a register checklist.
 */
export async function storeSetup(input: { orgId: string; facilityId: string }): Promise<SetupStep[] | null> {
  const { orgId, facilityId } = input;
  const [facility] = await db
    .select({ licenseType: facilities.licenseType, state: facilities.state })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.orgId, orgId)));
  if (!facility || (facility.licenseType !== "RETAIL" && facility.licenseType !== "MICROBUSINESS")) return null;

  const labGate = requiresLabBeforeRetail(packFor(facility.state));
  const passedLab = sql`(select lr.status from lab_results lr where lr.package_id = ${packages.id} order by lr.created_at desc limit 1) = 'PASS'`;

  const [[rooms], [stock], [sellable], [prices], [rules], [rewards], [discounts], [drawers]] = await Promise.all([
    db.select({ n: count() }).from(locations).where(and(eq(locations.orgId, orgId), eq(locations.facilityId, facilityId))),
    db.select({ n: count() }).from(packages).where(and(eq(packages.orgId, orgId), eq(packages.facilityId, facilityId), eq(packages.status, "ACTIVE"))),
    labGate
      ? db
          .select({ n: count() })
          .from(packages)
          .where(and(eq(packages.orgId, orgId), eq(packages.facilityId, facilityId), eq(packages.status, "ACTIVE"), sql`coalesce(${passedLab}, false)`))
      : Promise.resolve([{ n: 1 }]),
    db.select({ n: count() }).from(retailPrices).where(eq(retailPrices.facilityId, facilityId)),
    db.select().from(retailSettings).where(eq(retailSettings.facilityId, facilityId)),
    db.select({ enabled: rewardSettings.enabled }).from(rewardSettings).where(eq(rewardSettings.orgId, orgId)),
    db.select({ n: count() }).from(discountPresets).where(eq(discountPresets.orgId, orgId)),
    db.select({ n: count() }).from(drawerSessions).where(and(eq(drawerSessions.orgId, orgId), eq(drawerSessions.facilityId, facilityId))),
  ]);

  const taxed = !!rules && (Number(rules.exciseTaxPercent) > 0 || Number(rules.salesTaxPercent) > 0);
  return [
    { key: "rooms", title: "Add your rooms", detail: "A sales floor and a vault, so stock has somewhere to live.", href: "/locations", done: (rooms?.n ?? 0) > 0, required: true },
    { key: "stock", title: "Bring in your inventory", detail: "Import a file from your old system, or receive packages one by one.", href: "/inventory/receive", done: (stock?.n ?? 0) > 0, required: true },
    ...(labGate
      ? [{ key: "labs", title: "Record lab results", detail: "This state requires a passing lab result before a package can be sold.", href: "/inventory", done: (sellable?.n ?? 0) > 0, required: true }]
      : []),
    { key: "menu", title: "Put items on the menu with prices", detail: "Only items on the menu show up at the register.", href: "/pos/menu", done: (prices?.n ?? 0) > 0, required: true },
    { key: "rules", title: "Save your store rules", detail: "Purchase limits and warnings. The register stays locked until you do.", href: "/pos/menu#store-rules", done: !!rules, required: true },
    { key: "tax", title: "Enter your tax rates", detail: "Use the rates on your latest tax filing. Until then the register charges no tax.", href: "/pos/menu#store-rules", done: taxed, required: true },
    { key: "drawer", title: "Open the cash drawer", detail: "Count your starting cash, then you can ring up the first sale.", href: "/pos/drawer", done: (drawers?.n ?? 0) > 0, required: true },
    { key: "rewards", title: "Turn on rewards (optional)", detail: "Let regulars earn points at the register. Off until you turn it on.", href: "/pos/rewards", done: !!rewards?.enabled, required: false },
    { key: "discounts", title: "Add a discount (optional)", detail: "For example a veteran or first-time-customer discount. Discounts only appear at the register once one exists.", href: "/pos/menu", done: (discounts?.n ?? 0) > 0, required: false },
  ];
}
