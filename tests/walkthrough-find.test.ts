import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customers, facilities, harvestPackages, harvests, itemCategories, items, locations, orders, organizations, packages, strains, users } from "@/db/schema";
import { WALKTHROUGHS } from "@/lib/walkthroughs";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `WF${Date.now().toString(36).toUpperCase()}`;

describe("every walkthrough step knows where it happens", () => {
  it("has a fixed address or a way to find its record, so Next never leaves someone on the wrong page", () => {
    const stranded = WALKTHROUGHS.flatMap((w) => w.steps.filter((s) => !s.go && !s.find).map((s) => `${w.id}: ${s.title}`));
    expect(stranded).toEqual([]);
  });
});

describe.skipIf(!hasDb)("finding the record a walkthrough step happens on (database)", () => {
  let db: typeof import("@/lib/db").db;
  let pool: typeof import("@/lib/db").pool;
  let find: typeof import("@/lib/walkthrough-find").findWalkthroughPage;
  let at: { orgId: string; facilityId: string };
  let other: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, pool } = await import("@/lib/db"));
    ({ findWalkthroughPage: find } = await import("@/lib/walkthrough-find"));
    const [o] = await db.insert(organizations).values({ name: `Find ${run}` }).returning();
    const fs = await db
      .insert(facilities)
      .values([
        { orgId: o.id, name: "Here", licenseNumber: `${run}-H`, licenseType: "CULTIVATION", state: "NM" },
        { orgId: o.id, name: "There", licenseNumber: `${run}-T`, licenseType: "CULTIVATION", state: "NM" },
      ])
      .returning();
    at = { orgId: o.id, facilityId: fs[0].id };
    other = fs[1].id;
    const [u] = await db.insert(users).values({ orgId: o.id, name: "U", email: `u-${run}@t.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    const locs = await db
      .insert(locations)
      .values([
        { orgId: o.id, facilityId: at.facilityId, name: "A Empty", type: "ROOM" as const },
        { orgId: o.id, facilityId: at.facilityId, name: "B Full", type: "ROOM" as const },
      ])
      .returning();
    ids.full = locs[1].id;
    const [cat] = await db.insert(itemCategories).values({ orgId: o.id, name: "All" }).returning();
    const [it] = await db.insert(items).values({ orgId: o.id, name: "Bulk", sku: `${run}-B`, categoryId: cat.id, unit: "G" }).returning();
    const [st] = await db.insert(strains).values({ orgId: o.id, name: "S", type: "HYBRID" }).returning();
    const [c] = await db.insert(customers).values({ orgId: o.id, name: "Shop", licenseNumber: `${run}-C`, licenseType: "Retailer", licenseExpires: "2030-01-01" }).returning();
    const ord = (n: string, status: "DRAFT" | "CONFIRMED", facilityId = at.facilityId, ageMin = 0) =>
      ({ orgId: o.id, facilityId, number: `${run}-${n}`, customerId: c.id, status, userName: "U", createdAt: new Date(Date.now() - ageMin * 60000) }) as typeof orders.$inferInsert;
    const os = await db.insert(orders).values([ord("1", "CONFIRMED", at.facilityId, 5), ord("2", "CONFIRMED"), ord("3", "DRAFT", other)]).returning();
    ids.newestConfirmed = os[1].id;
    const pk = await db
      .insert(packages)
      .values([1, 2].map((k) => ({ orgId: o.id, facilityId: at.facilityId, tag: `${run}-P${k}`, itemId: it.id, quantity: "5", unit: "G" as const, locationId: ids.full, status: "ACTIVE" as const })))
      .returning();
    const hv = await db
      .insert(harvests)
      .values([
        { orgId: o.id, facilityId: at.facilityId, name: `${run}-OLD`, strainId: st.id, wetWeight: "10", harvestedAt: new Date(Date.now() - 86400000), userId: u.id, locationId: ids.full, plantCount: 1 },
        { orgId: o.id, facilityId: at.facilityId, name: `${run}-NEW`, strainId: st.id, wetWeight: "10", harvestedAt: new Date(), userId: u.id, locationId: ids.full, plantCount: 1 },
      ])
      .returning();
    ids.oldHarvest = hv[0].id;
    ids.newHarvest = hv[1].id;
    await db.insert(harvestPackages).values({ harvestId: hv[0].id, packageId: pk[0].id, weightGrams: "5" });
  });
  afterAll(() => pool.end());

  it("opens the newest record in the state the step needs, and never one in another state or another facility", async () => {
    expect(await find(at, "order", ["CONFIRMED"])).toBe(`/distribution/orders/${ids.newestConfirmed}`);
    // The only draft order is at another facility: nothing to show here, rather than the wrong order.
    expect(await find(at, "order", ["DRAFT"])).toBeNull();
    expect(await find(at, "run", ["IN_PROGRESS"])).toBeNull();
  });

  it("picks a harvest with packages to open, and a location with stock to count", async () => {
    expect(await find(at, "harvest", ["DRYING"])).toBe(`/cultivation/harvests/${ids.newHarvest}`);
    expect(await find(at, "harvest-packaged")).toBe(`/cultivation/harvests/${ids.oldHarvest}`);
    expect(await find(at, "count")).toBe(`/counts/${ids.full}`);
    expect(await find(at, "package-label")).toMatch(/^\/labels\?kind=PACKAGE&ids=/);
  });
});
