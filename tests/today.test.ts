import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customers, facilities, harvests, itemCategories, items, locations, orders, organizations, packages, strains, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays } from "@/lib/distribution-math";
import { todayList } from "@/lib/today";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `TD${Date.now().toString(36).toUpperCase()}`;
const today = "2026-11-19";

describe.skipIf(!hasDb)("needs attention today", () => {
  let org: string;
  let fac: string;
  let other: string;
  const all = { sales: true, inventory: true, cultivation: true };

  beforeAll(async () => {
    const [o] = await db.insert(organizations).values({ name: `Today ${run}` }).returning();
    org = o.id;
    const fs = await db
      .insert(facilities)
      .values([
        { orgId: org, name: "Here", licenseNumber: `${run}-H`, licenseType: "CULTIVATION", state: "NM" },
        { orgId: org, name: "Elsewhere", licenseNumber: `${run}-E`, licenseType: "CULTIVATION", state: "NM" },
      ])
      .returning();
    [fac, other] = fs.map((f) => f.id);
    const [u] = await db.insert(users).values({ orgId: org, name: "T", email: `t-${run}@t.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    const [loc] = await db.insert(locations).values({ orgId: org, facilityId: fac, name: "Vault", type: "ROOM" }).returning();
    const [cat] = await db.insert(itemCategories).values({ orgId: org, name: "All" }).returning();
    const [it] = await db.insert(items).values({ orgId: org, name: "Jar", sku: `${run}-J`, categoryId: cat.id, unit: "EACH" }).returning();
    const [st] = await db.insert(strains).values({ orgId: org, name: "S", type: "HYBRID" }).returning();
    const pk = (tag: string, status: "QUARANTINE" | "ON_HOLD" | "ACTIVE", facilityId = fac) =>
      ({ orgId: org, facilityId, tag: `${run}-${tag}`, itemId: it.id, quantity: "1", unit: "EACH", locationId: loc.id, status }) as typeof packages.$inferInsert;
    await db.insert(packages).values([pk("Q1", "QUARANTINE"), pk("H1", "ON_HOLD"), pk("H2", "ON_HOLD"), pk("A1", "ACTIVE"), pk("X1", "QUARANTINE", other)]);
    const cs = await db
      .insert(customers)
      .values([
        { orgId: org, name: "Expired", licenseNumber: `${run}-1`, licenseType: "Retailer", licenseExpires: addDays(today, -1) },
        { orgId: org, name: "Soon", licenseNumber: `${run}-2`, licenseType: "Retailer", licenseExpires: addDays(today, 10) },
        { orgId: org, name: "Fine", licenseNumber: `${run}-3`, licenseType: "Retailer", licenseExpires: addDays(today, 300) },
      ])
      .returning();
    const ord = (n: string, status: "CONFIRMED" | "PACKED" | "DELIVERED") =>
      ({ orgId: org, facilityId: fac, number: `${run}-${n}`, customerId: cs[2].id, status, userName: "T" }) as typeof orders.$inferInsert;
    await db.insert(orders).values([ord("1", "CONFIRMED"), ord("2", "CONFIRMED"), ord("3", "PACKED"), ord("4", "DELIVERED")]);
    await db.insert(harvests).values({ orgId: org, facilityId: fac, name: `${run}-HV`, strainId: st.id, wetWeight: "10", harvestedAt: new Date(), userId: u.id, locationId: loc.id, plantCount: 1 });
  });
  afterAll(() => pool.end());

  it("lists the urgent things first, counts only these facilities, and links a single item straight to it", async () => {
    const list = await todayList({ orgId: org, facilityIds: [fac], today, may: all });
    expect(list.map((i) => i.key)).toEqual(["licenses-expired", "quarantine", "to-pick", "to-ship", "dry-weight", "on-hold", "licenses-expiring"]);
    const by = Object.fromEntries(list.map((i) => [i.key, i]));
    expect(by.quarantine.text).toBe("1 package in quarantine");
    expect(by["to-pick"]).toMatchObject({ text: "2 orders to pick", href: "/distribution" });
    expect(by["to-ship"].href).toMatch(/^\/distribution\/orders\//);
    expect(by["dry-weight"].href).toMatch(/^\/cultivation\/harvests\//);
    expect(by["on-hold"].text).toBe("2 packages on hold");
    expect(by["licenses-expired"].tone).toBe("red");
    const both = await todayList({ orgId: org, facilityIds: [fac, other], today, may: all });
    expect(both.find((i) => i.key === "quarantine")?.text).toBe("2 packages in quarantine");
  });

  it("shows each kind of work only to people who may do it", async () => {
    const budtender = await todayList({ orgId: org, facilityIds: [fac], today, may: { sales: false, inventory: true, cultivation: false } });
    expect(budtender.map((i) => i.key)).toEqual(["quarantine", "on-hold"]);
    expect(await todayList({ orgId: org, facilityIds: [], today, may: all })).toEqual([]);
    await db.update(packages).set({ status: "ACTIVE" }).where(eq(packages.orgId, org));
    expect((await todayList({ orgId: org, facilityIds: [fac], today, may: { sales: false, inventory: true, cultivation: false } })).length).toBe(0);
  });
});
