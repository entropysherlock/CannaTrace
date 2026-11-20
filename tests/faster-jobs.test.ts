import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, harvests, itemCategories, items, labResults, locations, orderAllocations, orders, organizations, packages, strains, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { packageHarvestMany, recordDryWeight } from "@/lib/cultivation";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addOrderLine, autoPickOrder, confirmOrder, createCustomer, createOrder, verifyCustomerLicense } from "@/lib/distribution";
import { addLabResult, movePackages, receivePackage, setPackageStatus, setPackagesStatus, type Actor } from "@/lib/inventory";

/**
 * The speed-ups for jobs that used to be done one item at a time: bulk package actions, one lab result for a
 * whole lot, packaging a harvest into many packages, and picking a whole order automatically.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `FJ${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(3, "0")}`;

describe.skipIf(!hasDb)("faster jobs (database)", () => {
  let org: string;
  let grow: string;
  let actor: Actor;
  let vault: string;
  let dry: string;
  let bulk: string;
  let jar: string;
  let blueMesa: string;

  const pkg = async (id: string) => (await db.select().from(packages).where(eq(packages.id, id)))[0];
  const receive = (quantity = "100", itemId = bulk, lot?: string) => receivePackage(actor, { tag: tag(), itemId, quantity, locationId: vault, lotNumber: lot } as never);

  beforeAll(async () => {
    const [o] = await db.insert(organizations).values({ name: `Faster ${run}` }).returning();
    org = o.id;
    const [f] = await db.insert(facilities).values({ orgId: org, name: "Grow", licenseNumber: `${run}-G`, licenseType: "CULTIVATION", state: "NM" }).returning();
    grow = f.id;
    const [u] = await db.insert(users).values({ orgId: org, name: "Ines Inventory", email: `i-${run}@t.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    actor = { userId: u.id, userName: u.name, orgId: org, facilityId: grow };
    const locs = await db
      .insert(locations)
      .values([
        { orgId: org, facilityId: grow, name: "Vault", type: "ROOM" as const },
        { orgId: org, facilityId: grow, name: "Dry Room", type: "ROOM" as const },
      ])
      .returning();
    [vault, dry] = locs.map((l) => l.id);
    const [cat] = await db.insert(itemCategories).values({ orgId: org, name: "All" }).returning();
    const its = await db
      .insert(items)
      .values([
        { orgId: org, name: "Bulk Flower", sku: `${run}-B`, categoryId: cat.id, unit: "G" as const },
        { orgId: org, name: "Jar", sku: `${run}-J`, categoryId: cat.id, unit: "EACH" as const },
      ])
      .returning();
    [bulk, jar] = its.map((i) => i.id);
    const [st] = await db.insert(strains).values({ orgId: org, name: "Blue Mesa", type: "HYBRID" }).returning();
    blueMesa = st.id;
  });
  afterAll(() => pool.end());

  describe("bulk package actions", () => {
    it("moves many packages at once, skips any already there, and logs each move", async () => {
      const a = await receive(), b = await receive(), c = await receive();
      await movePackages(actor, { packageIds: [c.id], toLocationId: dry });
      const r = await movePackages(actor, { packageIds: [a.id, b.id, c.id, a.id], toLocationId: dry, note: "drying" });
      expect(r).toEqual({ moved: 2, alreadyThere: 1 });
      for (const p of [a, b, c]) expect((await pkg(p.id)).locationId).toBe(dry);
      const moves = await db.select().from(auditLogs).where(and(inArray(auditLogs.entityId, [a.id, b.id]), eq(auditLogs.action, "MOVE")));
      expect(moves).toHaveLength(2);
      expect(moves[0].after).toMatchObject({ locationName: "Dry Room" });
    });

    it("is all or nothing: one package that can't change stops them all and is named", async () => {
      const a = await receive(), b = await receive();
      await db.update(packages).set({ status: "FINISHED", quantity: "0" }).where(eq(packages.id, b.id));
      await expect(movePackages(actor, { packageIds: [a.id, b.id], toLocationId: dry })).rejects.toThrow(new RegExp(`${b.tag}.*Nothing was changed`));
      expect((await pkg(a.id)).locationId).toBe(vault);
    });

    it("holds, quarantines, and releases many at once, and won't release a failed package", async () => {
      const a = await receive(), b = await receive(), c = await receive();
      const held = await setPackagesStatus(actor, { packageIds: [a.id, b.id, c.id], status: "ON_HOLD", reason: "recount" });
      expect(held).toEqual({ changed: 3, already: 0 });
      await db.insert(labResults).values({ orgId: org, facilityId: grow, packageId: c.id, labName: "Lab", status: "FAIL", userId: actor.userId });
      await expect(setPackagesStatus(actor, { packageIds: [a.id, b.id, c.id], status: "ACTIVE", reason: "recounted" })).rejects.toThrow(/failed its most recent lab test.*Nothing was changed/);
      expect((await pkg(a.id)).status).toBe("ON_HOLD");
      const released = await setPackagesStatus(actor, { packageIds: [a.id, b.id], status: "ACTIVE", reason: "recounted" });
      expect(released.changed).toBe(2);
      await expect(setPackagesStatus(actor, { packageIds: [a.id], status: "ACTIVE", reason: " " })).rejects.toThrow(/Say why/);
      await expect(setPackagesStatus(actor, { packageIds: [], status: "ON_HOLD", reason: "x" })).rejects.toThrow(/Check at least one/);
    });
  });

  describe("one lab result for a whole lot", () => {
    it("records the result on every checked package, stores the COA once, and quarantines each on a fail", async () => {
      const lot = `${run}-LOT`;
      const ps = [await receive("50", bulk, lot), await receive("40", bulk, lot), await receive("30", bulk, lot)];
      const coa = { name: "coa.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 test") };
      const r = await addLabResult(actor, { packageId: ps[0].id, labName: "SW Labs", status: "FAIL", thcPercent: "21", coa, alsoPackageIds: [ps[1].id, ps[2].id, ps[0].id] });
      expect(r).toMatchObject({ recorded: 3, quarantinedCount: 3 });
      for (const p of ps) expect((await pkg(p.id)).status).toBe("QUARANTINE");
      const rows = await db.select().from(labResults).where(inArray(labResults.packageId, ps.map((p) => p.id)));
      expect(rows).toHaveLength(3);
      const holder = rows.find((x) => x.coaData)!;
      expect(rows.filter((x) => x.coaData)).toHaveLength(1);
      expect(rows.filter((x) => !x.coaData).every((x) => x.coaFromResultId === holder.id && x.coaFileName === "coa.pdf")).toBe(true);
      expect(rows.every((x) => x.thcPercent && Number(x.thcPercent) === 21)).toBe(true);
    });

    it("refuses finished packages in the list and saves nothing", async () => {
      const a = await receive(), b = await receive();
      await db.update(packages).set({ status: "FINISHED", quantity: "0" }).where(eq(packages.id, b.id));
      await expect(addLabResult(actor, { packageId: a.id, labName: "Lab", status: "PASS", alsoPackageIds: [b.id] })).rejects.toThrow(/uncheck it/);
      expect(await db.select().from(labResults).where(eq(labResults.packageId, a.id))).toHaveLength(0);
    });
  });

  describe("packaging a harvest into many packages", () => {
    const harvest = async () =>
      (
        await db
          .insert(harvests)
          .values({ orgId: org, facilityId: grow, name: tag(), strainId: blueMesa, wetWeight: "5000", harvestedAt: new Date(), userId: actor.userId, locationId: dry, plantCount: 4 })
          .returning()
      )[0];

    it("makes N same-size packages in one save, all from the harvest's lot", async () => {
      const h = await harvest();
      await recordDryWeight(actor, { harvestId: h.id, dryWeight: "1000", unit: "G" });
      const made = await packageHarvestMany(actor, { harvestId: h.id, tag: "", itemId: bulk, quantity: "200", locationId: vault, count: "4" });
      expect(made).toHaveLength(4);
      expect(new Set(made.map((p) => p.tag)).size).toBe(4);
      expect(made.every((p) => p.lotNumber === h.name && Number(p.quantity) === 200)).toBe(true);
      const [after] = await db.select().from(harvests).where(eq(harvests.id, h.id));
      expect(Number(after.packagedWeight)).toBe(800);
    });

    it("checks the total against what's left before making any, and matches given tags one to one", async () => {
      const h = await harvest();
      await recordDryWeight(actor, { harvestId: h.id, dryWeight: "500", unit: "G" });
      await expect(packageHarvestMany(actor, { harvestId: h.id, tag: "", itemId: bulk, quantity: "200", locationId: vault, count: "3" })).rejects.toThrow(/3 packages of 200 g is 600 g but only 500 g/);
      await expect(packageHarvestMany(actor, { harvestId: h.id, tag: "A1, A2", itemId: bulk, quantity: "100", locationId: vault, count: "3" })).rejects.toThrow(/2 tags for 3 packages/);
      await expect(packageHarvestMany(actor, { harvestId: h.id, tag: "", itemId: bulk, quantity: "1", locationId: vault, count: "1000" })).rejects.toThrow(/at most 100/);
      const tags = [tag(), tag()];
      const made = await packageHarvestMany(actor, { harvestId: h.id, tag: tags.join("\n"), itemId: bulk, quantity: "100", locationId: vault, count: "2" });
      expect(made.map((p) => p.tag)).toEqual(tags);
      expect(await db.$count(packages, eq(packages.lotNumber, h.name))).toBe(2);
    });
  });

  describe("picking a whole order automatically", () => {
    it("fills each line oldest first, splits only what's needed, skips held and failed stock, and reports any shortfall", async () => {
      const c = await createCustomer(actor, { name: "Shop", licenseNumber: `${run}-SHOP`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 300) });
      await verifyCustomerLicense(actor, { customerId: c.id });
      const oldest = await receive("10", jar);
      const failed = await receive("10", jar);
      await db.insert(labResults).values({ orgId: org, facilityId: grow, packageId: failed.id, labName: "Lab", status: "FAIL", userId: actor.userId });
      const held = await receive("10", jar);
      await setPackageStatus(actor, { packageId: held.id, status: "ON_HOLD", reason: "recount" });
      const newer = await receive("10", jar);
      const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, org));
      const [shake] = await db.insert(items).values({ orgId: org, name: "Shake", sku: `${run}-S`, categoryId: cat.id, unit: "G" as const }).returning();
      const flower = await receive("30", shake.id);

      const order = await createOrder(actor, { customerId: c.id });
      await addOrderLine(actor, { orderId: order.id, itemId: jar, quantity: "14", unitPrice: "10" });
      await addOrderLine(actor, { orderId: order.id, itemId: shake.id, quantity: "50", unitPrice: "3" });
      await confirmOrder(actor, { orderId: order.id });

      const { picked, short } = await autoPickOrder(actor, { orderId: order.id });
      const allocations = await db.select().from(orderAllocations).where(eq(orderAllocations.orderId, order.id));
      // Jars: the whole oldest package (10), then 4 split off the next good one (failed and held are skipped).
      expect((await pkg(oldest.id)).status).toBe("ALLOCATED");
      expect(Number((await pkg(newer.id)).quantity)).toBe(6);
      expect((await pkg(failed.id)).status).toBe("ACTIVE");
      expect((await pkg(held.id)).status).toBe("ON_HOLD");
      // Flower: all 30 there is, and the rest reported short.
      expect((await pkg(flower.id)).status).toBe("ALLOCATED");
      expect(short).toEqual([{ item: "Shake", missing: "20" }]);
      expect(picked).toHaveLength(3);
      expect(allocations.reduce((sum, a) => sum + Number(a.quantity), 0)).toBe(44);
      // Running it again picks nothing new for the jars and still reports the flower short.
      const again = await autoPickOrder(actor, { orderId: order.id });
      expect(again.picked).toHaveLength(0);
      expect(again.short).toEqual([{ item: "Shake", missing: "20" }]);
      expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("CONFIRMED");
    });
  });
});
