import "server-only";
import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { drawerSessions, harvestPackages, harvests, locations, orders, packages, plantBatches, productionRuns, sales } from "@/db/schema";
import { db } from "@/lib/db";
import type { FindKind } from "@/lib/walkthroughs";

type Place = { orgId: string; facilityId: string };

/**
 * The newest row at this facility, trying each wanted status in turn. With no statuses given, any row. A step
 * that needs a particular state (a draft order) never gets one in another state, where its card wouldn't be.
 */
async function newest(
  table: PgTable & { id: PgColumn; orgId: PgColumn; facilityId: PgColumn; status: PgColumn },
  newestFirst: PgColumn,
  at: Place,
  statuses: readonly string[],
): Promise<string | null> {
  const here: SQL = and(eq(table.orgId, at.orgId), eq(table.facilityId, at.facilityId))!;
  for (const status of statuses.length ? statuses : [null]) {
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(status ? and(here, eq(table.status, status)) : here)
      .orderBy(desc(newestFirst))
      .limit(1);
    if (row) return String(row.id);
  }
  return null;
}

/**
 * The page a walkthrough step should open when it happens on one particular record (a harvest, an order)
 * and the person isn't on one: the newest record here in the state the step needs. Null when there is none.
 */
export async function findWalkthroughPage(at: Place, kind: FindKind, statuses: readonly string[] = []): Promise<string | null> {
  switch (kind) {
    case "harvest-packaged": {
      // A harvest that has packages to open, newest first.
      const [row] = await db
        .select({ id: harvests.id })
        .from(harvests)
        .innerJoin(harvestPackages, eq(harvestPackages.harvestId, harvests.id))
        .where(and(eq(harvests.orgId, at.orgId), eq(harvests.facilityId, at.facilityId)))
        .orderBy(desc(harvests.harvestedAt))
        .limit(1);
      return row ? `/cultivation/harvests/${row.id}` : null;
    }
    case "harvest": {
      const id = await newest(harvests, harvests.harvestedAt, at, statuses);
      return id && `/cultivation/harvests/${id}`;
    }
    case "package": {
      const id = await newest(packages, packages.createdAt, at, statuses);
      return id && `/inventory/${id}`;
    }
    case "package-label": {
      const id = await newest(packages, packages.createdAt, at, statuses.length ? statuses : ["ACTIVE"]);
      return id && `/labels?kind=PACKAGE&ids=${id}`;
    }
    case "batch": {
      const id = await newest(plantBatches, plantBatches.createdAt, at, statuses);
      return id && `/cultivation/batches/${id}`;
    }
    case "run": {
      const id = await newest(productionRuns, productionRuns.createdAt, at, statuses);
      return id && `/manufacturing/runs/${id}`;
    }
    case "order": {
      const id = await newest(orders, orders.createdAt, at, statuses);
      return id && `/distribution/orders/${id}`;
    }
    case "sale": {
      const id = await newest(sales, sales.createdAt, at, statuses);
      return id && `/pos/sales/${id}`;
    }
    case "receipt": {
      const id = await newest(sales, sales.createdAt, at, statuses.length ? statuses : ["COMPLETED"]);
      return id && `/pos/sales/${id}/receipt`;
    }
    case "drawer": {
      const id = await newest(drawerSessions, drawerSessions.openedAt, at, statuses);
      return id && `/pos/drawer/${id}`;
    }
    case "count": {
      // The location holding the most stock, so there's something to count.
      const [loc] = await db
        .select({ id: locations.id, n: count(packages.id) })
        .from(locations)
        .innerJoin(packages, eq(packages.locationId, locations.id))
        .where(and(eq(locations.orgId, at.orgId), eq(locations.facilityId, at.facilityId), inArray(packages.status, ["ACTIVE", "ON_HOLD", "QUARANTINE"])))
        .groupBy(locations.id)
        .orderBy(desc(count(packages.id)))
        .limit(1);
      return loc ? `/counts/${loc.id}` : null;
    }
  }
}
