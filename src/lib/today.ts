import { and, count, eq, inArray, isNull, lte, min } from "drizzle-orm";
import { customers, facilities, harvests, orders, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { addDays } from "@/lib/distribution-math";

/** One thing someone should do today, linked to where they do it. */
export type TodayItem = { key: string; text: string; href: string; tone: "red" | "amber" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What needs attention today across the given facilities, most urgent first. Each kind of work shows only to
 * people who may do it, and a single item links straight to it.
 */
export async function todayList(input: {
  orgId: string;
  facilityIds: string[];
  today: string;
  may: { sales: boolean; inventory: boolean; cultivation: boolean };
}): Promise<TodayItem[]> {
  const { orgId, facilityIds: ids, today, may } = input;
  if (!ids.length) return [];
  const items: TodayItem[] = [];

  const [orderRows, packageRows, harvestRows, licenseRows, ownLicenseRows] = await Promise.all([
    may.sales
      ? db
          .select({ status: orders.status, n: count(), one: min(orders.id) })
          .from(orders)
          .where(and(eq(orders.orgId, orgId), inArray(orders.facilityId, ids), inArray(orders.status, ["CONFIRMED", "PACKED", "SHIPPED"])))
          .groupBy(orders.status)
      : [],
    may.inventory
      ? db
          .select({ status: packages.status, n: count() })
          .from(packages)
          .where(and(eq(packages.orgId, orgId), inArray(packages.facilityId, ids), inArray(packages.status, ["QUARANTINE", "ON_HOLD"])))
          .groupBy(packages.status)
      : [],
    may.cultivation
      ? db
          .select({ n: count(), one: min(harvests.id) })
          .from(harvests)
          .where(and(eq(harvests.orgId, orgId), inArray(harvests.facilityId, ids), eq(harvests.status, "DRYING"), isNull(harvests.dryWeight)))
      : [],
    may.sales
      ? db
          .select({ expired: customers.licenseExpires })
          .from(customers)
          .where(and(eq(customers.orgId, orgId), eq(customers.active, true), lte(customers.licenseExpires, addDays(today, 30))))
      : [],
    // The business's own licenses, from scanned license documents.
    db
      .select({ name: facilities.name, expires: facilities.licenseExpires })
      .from(facilities)
      .where(and(eq(facilities.orgId, orgId), inArray(facilities.id, ids), lte(facilities.licenseExpires, addDays(today, 60)))),
  ]);

  const byStatus = new Map(orderRows.map((r) => [r.status, r]));
  const orderLink = (r: { n: number; one: string | null }) => (r.n === 1 && r.one ? `/distribution/orders/${r.one}` : "/distribution");
  const pkgCount = new Map(packageRows.map((r) => [r.status, r.n]));

  const expired = licenseRows.filter((r) => r.expired < today).length;
  const expiring = licenseRows.length - expired;
  if (expired) items.push({ key: "licenses-expired", text: `${plural(expired, "vendor license")} expired — they can't receive shipments`, href: "/distribution/customers", tone: "red" });
  for (const f of ownLicenseRows) {
    if (!f.expires) continue;
    const gone = f.expires < today;
    items.unshift({ key: `own-license-${f.name}`, text: gone ? `${f.name}'s license expired on ${f.expires}` : `${f.name}'s license expires on ${f.expires}`, href: "/settings", tone: gone ? "red" : "amber" });
  }
  const quarantined = pkgCount.get("QUARANTINE") ?? 0;
  if (quarantined) items.push({ key: "quarantine", text: `${plural(quarantined, "package")} in quarantine`, href: "/inventory?status=QUARANTINE", tone: "red" });

  const confirmed = byStatus.get("CONFIRMED");
  if (confirmed?.n) items.push({ key: "to-pick", text: `${plural(confirmed.n, "order")} to pick`, href: orderLink(confirmed), tone: "amber" });
  const packed = byStatus.get("PACKED");
  if (packed?.n) items.push({ key: "to-ship", text: `${plural(packed.n, "order")} packed and ready to ship`, href: orderLink(packed), tone: "amber" });
  const shipped = byStatus.get("SHIPPED");
  if (shipped?.n) items.push({ key: "to-deliver", text: `${plural(shipped.n, "shipment")} out for delivery — mark delivered when signed for`, href: orderLink(shipped), tone: "amber" });

  const drying = harvestRows[0];
  if (drying?.n)
    items.push({
      key: "dry-weight",
      text: `${plural(drying.n, "harvest")} waiting for a dry weight`,
      href: drying.n === 1 && drying.one ? `/cultivation/harvests/${drying.one}` : "/cultivation/harvests",
      tone: "amber",
    });
  const held = pkgCount.get("ON_HOLD") ?? 0;
  if (held) items.push({ key: "on-hold", text: `${plural(held, "package")} on hold`, href: "/inventory?status=ON_HOLD", tone: "amber" });
  if (expiring) items.push({ key: "licenses-expiring", text: `${plural(expiring, "vendor license")} expiring within 30 days`, href: "/distribution/customers", tone: "amber" });

  return items;
}
