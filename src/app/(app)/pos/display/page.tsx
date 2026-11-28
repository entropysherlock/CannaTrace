import { getExclusions } from "@/lib/loyalty-earn";
import { eligibleShare } from "@/lib/loyalty-math";
import Decimal from "decimal.js";
import { and, desc, eq, gt } from "drizzle-orm";
import { CustomerDisplay, type DisplayView } from "@/components/register/customer-display";
import { facilities, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { cartPromos } from "@/lib/promotions";
import { cartLines, getRetailSettings, msAgo, myOpenDrawer, saleTotals } from "@/lib/pos";
import { getProgram } from "@/lib/rewards";
import { requirePagePermission } from "@/lib/session";

/** The screen that faces the customer: what is in their cart and what they owe. Refreshes itself. */
export default async function CustomerDisplayPage() {
  const session = await requirePagePermission("pos.use");
  const [[facility], [drawer]] = await Promise.all([
    db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, session.facilityId)),
    // The customer screen follows the drawer of the person signed in at this register.
    myOpenDrawer(db, { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }).then((d) => [d ?? undefined]),
  ]);
  let view: DisplayView = { store: facility?.name ?? "", state: "welcome" };
  if (drawer) {
    const [open] = await db
      .select()
      .from(sales)
      .where(and(eq(sales.drawerSessionId, drawer.id), eq(sales.status, "OPEN")))
      .orderBy(desc(sales.createdAt))
      .limit(1);
    const [paid] = await db
      .select()
      .from(sales)
      .where(and(eq(sales.drawerSessionId, drawer.id), eq(sales.status, "COMPLETED"), gt(sales.completedAt, msAgo(45_000))))
      .orderBy(desc(sales.completedAt))
      .limit(1);
    if (paid && (!open || (paid.completedAt ?? paid.createdAt) > open.createdAt)) {
      view = { store: view.store, state: "thanks", total: new Decimal(paid.total ?? 0).toFixed(2), change: new Decimal(paid.changeDue ?? 0).toFixed(2) };
    } else if (open) {
      const [lines, settings, program] = await Promise.all([cartLines(db, open.id), getRetailSettings(db, session.facilityId), getProgram(db, session.orgId)]);
      const promos = await cartPromos(db, session, lines);
      const totals = saleTotals(lines, open, settings, program, promos.total, eligibleShare(lines, await getExclusions(db, session.orgId)));
      // The customer sees one "savings" line: the percent discount and any rewards together.
      const off = totals.promo.add(totals.discount).add(totals.reward);
      view = {
        store: view.store,
        state: "cart",
        lines: lines.map((l) => ({
          id: l.id,
          name: l.itemName,
          quantity: new Decimal(l.quantity).toString(),
          total: new Decimal(l.quantity).mul(l.unitPrice).toDecimalPlaces(2).toFixed(2),
        })),
        discount: off.gt(0) ? off.toFixed(2) : null,
        taxes: totals.exciseTax.add(totals.salesTax).toFixed(2),
        total: totals.total.toFixed(2),
      };
    }
  }
  return <CustomerDisplay view={view} />;
}
