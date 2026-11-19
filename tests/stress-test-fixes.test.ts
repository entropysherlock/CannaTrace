import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drawerSessions, drivers, facilities, itemCategories, items, labResults, locations, organizations, packages, users, vehicles } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import {
  addOrderLine,
  allocateToOrder,
  confirmOrder,
  createCustomer,
  createDriver,
  createOrder,
  createVehicle,
  packOrder,
  recordPayment,
  shipOrder,
  verifyCustomerLicense,
} from "@/lib/distribution";
import { allowedFacilities, homeFacility } from "@/lib/facility-access";
import { toFormError } from "@/lib/form";
import {
  addLabResult,
  adjustPackage,
  consumeFromPackageInTx,
  latestLabStatus,
  receivePackage,
  setPackageStatus,
  splitPackage,
  type Actor,
} from "@/lib/inventory";
import { addToCart, checkInCustomer, closeDrawer, completeSale, createDiscount, openDrawer, removeDiscount, saveRetailSettings, setCartDiscount, setMenuItem } from "@/lib/pos";
import { discountPresets, sales } from "@/db/schema";
import { PermissionError, sessionFromToken } from "@/lib/session";
import { metrcRequest } from "@/lib/sync";
import { setUserFacilities } from "@/lib/team";
import { facilityToday, zoneForState } from "@/lib/time";
import { sweepFacility, sweepIfStale } from "@/lib/watch";

/**
 * Regression tests for the problems found by role-by-role stress testing (November 2026): failed-lab
 * product leaving the building, limits reset by a second cart, shared drawers and open counts, facility
 * access, fractional counted items, future dates, time zones, and permission messages.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `ST${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(3, "0")}`;

describe("pure helpers", () => {
  it("gives each state its own time zone, and dates follow it", () => {
    expect(zoneForState("NM")).toBe("America/Denver");
    expect(zoneForState("CA")).toBe("America/Los_Angeles");
    expect(zoneForState("MI")).toBe("America/Detroit");
    expect(zoneForState(null)).toBe("America/Denver");
    // 07:30 UTC on Jan 1 is still Dec 31 in California, but Jan 1 in New Mexico.
    const event = { type: "PACKAGE_ADJUSTED", createdAt: new Date("2026-01-01T07:30:00Z"), payload: { before: { quantity: "5" }, after: { quantity: "4", tag: "T", unit: "EACH" }, reason: "Damage" } };
    const date = (zone: string) => (metrcRequest(event as never, zone)!.body as { AdjustmentDate: string }[])[0].AdjustmentDate;
    expect(date("America/Denver")).toBe("2026-01-01");
    expect(date("America/Los_Angeles")).toBe("2025-12-31");
  });

  it("works out which facilities someone may use and where they land", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(allowedFacilities({ role: "OWNER", facilityIds: ["a"] })).toBeNull();
    expect(allowedFacilities({ role: "BUDTENDER", facilityIds: [] })).toBeNull();
    expect(allowedFacilities({ role: "BUDTENDER", facilityIds: ["b"] })).toEqual(["b"]);
    expect(homeFacility(list, { role: "BUDTENDER", facilityIds: ["b", "c"] }, "c")?.id).toBe("c");
    expect(homeFacility(list, { role: "BUDTENDER", facilityIds: ["b", "c"] }, "a")?.id).toBe("b");
    expect(homeFacility(list, { role: "MANAGER", facilityIds: null }, null)?.id).toBe("a");
  });

  it("explains a permission refusal instead of calling it a crash", () => {
    expect(toFormError(new PermissionError("Your role does not allow this action."))).toEqual({ error: "Your role does not allow this action." });
  });
});

describe.skipIf(!hasDb)("stress-test fixes (database)", () => {
  let org: string;
  let store: string;
  let grow: string;
  let caStore: string;
  let manager: Actor;
  let bud: Actor;
  let growActor: Actor;
  let budId: string;
  let ownerId: string;
  let jar: string;
  let bulk: string;
  let vault: string;
  let floor: string;
  let customerId: string;
  let driverId: string;
  let vehicleId: string;

  const status = async (id: string) => (await db.select().from(packages).where(eq(packages.id, id)))[0].status;
  const fail = (actor: Actor, packageId: string) =>
    db.insert(labResults).values({ orgId: actor.orgId, facilityId: actor.facilityId, packageId, labName: "Lab", status: "FAIL", userId: actor.userId });

  beforeAll(async () => {
    const [o] = await db.insert(organizations).values({ name: `Stress ${run}` }).returning();
    org = o.id;
    const made = await db
      .insert(facilities)
      .values([
        { orgId: org, name: "Store", licenseNumber: `${run}-S`, licenseType: "RETAIL", state: "NM" },
        { orgId: org, name: "Grow", licenseNumber: `${run}-G`, licenseType: "CULTIVATION", state: "NM" },
        { orgId: org, name: "LA Store", licenseNumber: `${run}-C`, licenseType: "RETAIL", state: "CA" },
      ])
      .returning();
    [store, grow, caStore] = made.map((f) => f.id);
    const people = await db
      .insert(users)
      .values([
        { orgId: org, name: "Mia Manager", email: `m-${run}@t.invalid`, passwordHash: "x", role: "MANAGER" as const },
        { orgId: org, name: "Bo Bud", email: `b-${run}@t.invalid`, passwordHash: "x", role: "BUDTENDER" as const },
        { orgId: org, name: "Oz Owner", email: `o-${run}@t.invalid`, passwordHash: "x", role: "OWNER" as const },
      ])
      .returning();
    manager = { userId: people[0].id, userName: people[0].name, orgId: org, facilityId: store };
    bud = { userId: people[1].id, userName: people[1].name, orgId: org, facilityId: store };
    growActor = { ...manager, facilityId: grow };
    budId = people[1].id;
    ownerId = people[2].id;
    const locs = await db
      .insert(locations)
      .values([
        { orgId: org, facilityId: store, name: "Floor", type: "ROOM" as const },
        { orgId: org, facilityId: grow, name: "Vault", type: "ROOM" as const },
      ])
      .returning();
    [floor, vault] = locs.map((l) => l.id);
    const [cat] = await db.insert(itemCategories).values({ orgId: org, name: "All" }).returning();
    const its = await db
      .insert(items)
      .values([
        { orgId: org, name: "Jar", sku: `${run}-JAR`, categoryId: cat.id, unit: "EACH" as const },
        { orgId: org, name: "Bulk", sku: `${run}-BULK`, categoryId: cat.id, unit: "G" as const },
      ])
      .returning();
    [jar, bulk] = its.map((i) => i.id);

    await saveRetailSettings(manager, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "7.5", medicalTaxExempt: true });
    await setMenuItem(manager, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });

    const c = await createCustomer(growActor, { name: "Shop", licenseNumber: `${run}-CUST`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 300) });
    customerId = c.id;
    await verifyCustomerLicense(growActor, { customerId });
    await createDriver(growActor, { name: "Dee", licenseNumber: "D-1" });
    await createVehicle(growActor, { make: "Ford", model: "Van", plate: run.slice(0, 8) });
    driverId = (await db.select().from(drivers).where(eq(drivers.orgId, org)))[0].id;
    vehicleId = (await db.select().from(vehicles).where(eq(vehicles.orgId, org)))[0].id;
  });
  afterAll(() => pool.end());

  describe("failed lab product stays put", () => {
    it("can't be released back to active until a retest passes", async () => {
      const pkg = await receivePackage(growActor, { tag: tag(), itemId: bulk, quantity: "100", locationId: vault });
      const r = await addLabResult(growActor, { packageId: pkg.id, labName: "Lab", status: "FAIL", notes: "E. coli" });
      expect(r.quarantined).toBe(true);
      await expect(setPackageStatus(growActor, { packageId: pkg.id, status: "ACTIVE", reason: "ok" })).rejects.toThrow(/failed its most recent lab test/);
      await setPackageStatus(growActor, { packageId: pkg.id, status: "ON_HOLD", reason: "waiting on retest" });
      await addLabResult(growActor, { packageId: pkg.id, labName: "Lab", status: "PASS" });
      await setPackageStatus(growActor, { packageId: pkg.id, status: "ACTIVE", reason: "retest passed" });
      expect(await status(pkg.id)).toBe("ACTIVE");
    });

    it("is followed into packages split from it, can't be picked for an order, and can't be used in production", async () => {
      const pkg = await receivePackage(growActor, { tag: tag(), itemId: jar, quantity: "20", locationId: vault });
      // Split first: a failed package can't be split, but a part split off before the result came back carries it.
      const { children } = await splitPackage(growActor, { packageId: pkg.id, parts: [{ quantity: "5" }] });
      await fail(growActor, pkg.id); // recorded directly, so the package is still active
      expect(await db.transaction((tx) => latestLabStatus(tx, children[0].id))).toBe("FAIL");

      const o = await createOrder(growActor, { customerId });
      await addOrderLine(growActor, { orderId: o.id, itemId: jar, quantity: "5", unitPrice: "10" });
      await confirmOrder(growActor, { orderId: o.id });
      const lineId = (await db.execute<{ id: string }>(`select id from order_lines where order_id = '${o.id}'` as never)).rows[0].id;
      await expect(allocateToOrder(growActor, { orderId: o.id, lineId, tag: children[0].tag })).rejects.toThrow(/failed its most recent lab test, so it cannot be put on an order/);
      await expect(allocateToOrder(growActor, { orderId: o.id, lineId, tag: pkg.tag, quantity: "5" })).rejects.toThrow(/cannot be put on an order/);
      await expect(
        db.transaction((tx) => consumeFromPackageInTx(tx, growActor, { packageId: pkg.id, quantity: "1", note: "run" })),
      ).rejects.toThrow(/cannot be used in production/);
    });

    it("can't ship when the failure arrives after picking, and Watch flags failed product that already left", async () => {
      const good = await receivePackage(growActor, { tag: tag(), itemId: jar, quantity: "10", locationId: vault });
      const late = await receivePackage(growActor, { tag: tag(), itemId: jar, quantity: "10", locationId: vault });
      const pick = async (pkgTag: string) => {
        const o = await createOrder(growActor, { customerId });
        await addOrderLine(growActor, { orderId: o.id, itemId: jar, quantity: "10", unitPrice: "10" });
        await confirmOrder(growActor, { orderId: o.id });
        const lineId = (await db.execute<{ id: string }>(`select id from order_lines where order_id = '${o.id}'` as never)).rows[0].id;
        await allocateToOrder(growActor, { orderId: o.id, lineId, tag: pkgTag });
        await packOrder(growActor, { orderId: o.id });
        return o;
      };
      const departAt = new Date(Date.now() + 3_600_000).toISOString();

      const blocked = await pick(late.tag);
      await fail(growActor, late.id);
      await expect(shipOrder(growActor, { orderId: blocked.id, driverId, vehicleId, departAt })).rejects.toThrow(/cannot be shipped/);

      const shipped = await pick(good.tag);
      const { manifestNumber } = await shipOrder(growActor, { orderId: shipped.id, driverId, vehicleId, departAt });
      await fail(growActor, good.id); // the result comes back after the product has gone
      await sweepFacility({ orgId: org, facilityId: grow });
      const recall = (await db.execute<{ title: string; detail: string; severity: string }>(
        `select title, detail, severity from watch_findings where org_id = '${org}' and facility_id = '${grow}' and "check" = 'recall' and status = 'OPEN'` as never,
      )).rows;
      expect(recall).toHaveLength(1);
      expect(recall[0].severity).toBe("critical");
      expect(recall[0].title).toContain(good.tag);
      expect(recall[0].detail).toContain(manifestNumber);
      expect(recall[0].detail).toContain("Shop");
    });
  });

  describe("the register", () => {
    let stock: string;
    beforeAll(async () => {
      stock = (await receivePackage(manager, { tag: tag(), itemId: jar, quantity: "200", locationId: floor })).id;
      await addLabResult(manager, { packageId: stock, labName: "Lab", status: "PASS" });
    });
    const adult = () => ({ birthDate: "1985-01-01", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" });
    const buy = async (who: Actor, count: number, idNumber?: string) => {
      const cart = await checkInCustomer(who, { ...adult(), idNumber });
      await addToCart(who, { saleId: cart.id, itemId: jar, quantity: String(count) });
      return completeSale(who, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "5000" });
    };

    it("gives each person their own drawer, and a manager can close one left open", async () => {
      await openDrawer(bud, { openingCash: "100" });
      await openDrawer(manager, { openingCash: "50" });
      await expect(openDrawer(bud, { openingCash: "100" })).rejects.toThrow(/already open/);
      await buy(bud, 1);
      await buy(manager, 2);
      const open = await db.select().from(drawerSessions).where(eq(drawerSessions.facilityId, store));
      const mine = open.find((d) => d.userId === budId)!;
      expect(mine.openedByName).toBe("Bo Bud");
      const closed = await closeDrawer(manager, { countedCash: "0", drawerId: mine.id });
      // Bo's drawer held 100 plus one jar's cash; the manager's sale is not in it.
      const [row] = await db.select().from(drawerSessions).where(eq(drawerSessions.id, closed.id));
      expect(Number(row.expectedCash)).toBeGreaterThan(100);
      expect(Number(row.expectedCash)).toBeLessThan(150);
      await closeDrawer(manager, { countedCash: "0" });
    });

    it("counts a scanned ID's earlier purchases today, even with the daily setting off", async () => {
      await openDrawer(bud, { openingCash: "100" });
      await buy(bud, 16, "NM-123456");
      await expect(buy(bud, 16, "NM-123456")).rejects.toThrow(/limit/i);
      await buy(bud, 1, "NM-999999"); // someone else is fine
    });

    it("closes a drawer past empty carts, cancelling them, but names a cart that still has items", async () => {
      // Bo's drawer from the previous test is open. One empty cart (ID checked, nothing added), one with an item.
      const empty = await checkInCustomer(bud, adult());
      const full = await checkInCustomer(bud, adult());
      await addToCart(bud, { saleId: full.id, itemId: jar, quantity: "1" });
      const fullNumber = (await db.select().from(sales).where(eq(sales.id, full.id)))[0].number;
      await expect(closeDrawer(bud, { countedCash: "100" })).rejects.toThrow(new RegExp(`Cart ${fullNumber} is still open with items`));
      // Cancel the one with items; the empty one no longer blocks the close
      await (await import("@/lib/pos")).cancelCart(bud, { saleId: full.id });
      await closeDrawer(bud, { countedCash: "100" });
      expect((await db.select().from(sales).where(eq(sales.id, empty.id)))[0].status).toBe("CANCELLED");
    });

    it("sells counted items in whole numbers only", async () => {
      await openDrawer(bud, { openingCash: "100" });
      const cart = await checkInCustomer(bud, adult());
      await expect(addToCart(bud, { saleId: cart.id, itemId: jar, quantity: "1.5" })).rejects.toThrow(/whole number/);
    });
  });

  describe("discounts", () => {
    it("can be removed from the store's list, kept on carts that have it, and brought back by name", async () => {
      await createDiscount(manager, { name: "Veteran", percent: "10" });
      const [vet] = await db.select().from(discountPresets).where(eq(discountPresets.orgId, org));
      await openDrawer(bud, { openingCash: "100" }).catch(() => {});
      const cartWithIt = await checkInCustomer(bud, { birthDate: "1985-01-01", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" });
      await setCartDiscount(bud, { saleId: cartWithIt.id, discountId: vet.id });

      expect(await removeDiscount(manager, { discountId: vet.id })).toBe("Veteran");
      await expect(removeDiscount(manager, { discountId: vet.id })).rejects.toThrow(/already be removed/);
      // A new cart can't choose it; the cart that already had it keeps it
      const fresh = await checkInCustomer(bud, { birthDate: "1985-01-01", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" });
      await expect(setCartDiscount(bud, { saleId: fresh.id, discountId: vet.id })).rejects.toThrow(/Pick a discount/);
      expect((await db.select().from(sales).where(eq(sales.id, cartWithIt.id)))[0].discountName).toBe("Veteran");

      // Adding the same name again brings it back with the new percentage, instead of "already exists"
      await createDiscount(manager, { name: "veteran", percent: "15" });
      const [back] = await db.select().from(discountPresets).where(eq(discountPresets.id, vet.id));
      expect([back.active, Number(back.percent)]).toEqual([true, 15]);
      await expect(createDiscount(manager, { name: "Veteran", percent: "5" })).rejects.toThrow(/already a discount called/);
    });
  });

  describe("Tally Watch clears what's been fixed", () => {
    it("drops a finding on the next look once it's fixed by hand, without a dismiss or a 15-minute wait", async () => {
      const scope = { orgId: org, facilityId: grow };
      const pkg = await receivePackage(growActor, { tag: tag(), itemId: bulk, quantity: "50", locationId: vault });
      await fail(growActor, pkg.id); // failed, but still active: Watch flags it
      await sweepFacility(scope);
      const open = async () =>
        (await db.execute<{ n: number }>(`select count(*)::int as n from watch_findings where facility_id = '${grow}' and "check" = 'lab_fail' and key like '%${pkg.id}%' and status = 'OPEN'` as never)).rows[0].n;
      expect(await open()).toBe(1);
      // Fixed on the package page, not through Watch
      await setPackageStatus(growActor, { packageId: pkg.id, status: "ON_HOLD", reason: "failed test" });
      await sweepIfStale(scope); // the last look was seconds ago, but something changed since
      expect(await open()).toBe(0);
      // Nothing changed: no new look (the last sweep stays the latest)
      const sweeps = async () => (await db.execute<{ n: number }>(`select count(*)::int as n from watch_sweeps where facility_id = '${grow}'` as never)).rows[0].n;
      const before = await sweeps();
      await sweepIfStale(scope);
      expect(await sweeps()).toBe(before);
    });
  });

  describe("input checks", () => {
    it("refuses fractions of counted items, absurd quantities, and future dates", async () => {
      await expect(receivePackage(growActor, { tag: tag(), itemId: jar, quantity: "1.5", locationId: vault })).rejects.toThrow(/whole number/);
      await expect(receivePackage(growActor, { tag: tag(), itemId: bulk, quantity: "1e30", locationId: vault })).rejects.toThrow(/too large/);
      const pkg = await receivePackage(growActor, { tag: tag(), itemId: jar, quantity: "10", locationId: vault });
      await expect(adjustPackage(growActor, { packageId: pkg.id, newQuantity: "7.5", reasonCode: "COUNT_CORRECTION" })).rejects.toThrow(/whole number/);
      await expect(splitPackage(growActor, { packageId: pkg.id, parts: [{ quantity: "0.25" }] })).rejects.toThrow(/whole number/);
      const o = await createOrder(growActor, { customerId });
      await expect(addOrderLine(growActor, { orderId: o.id, itemId: jar, quantity: "2.5", unitPrice: "10" })).rejects.toThrow(/whole number/);
      await expect(addLabResult(growActor, { packageId: pkg.id, labName: "Lab", status: "PASS", sampleDate: addDays(todayIn(), 30) })).rejects.toThrow(/in the future/);
    });

    it("refuses a payment dated in the future", async () => {
      const inv = (await db.execute<{ id: string }>(`select id from invoices where org_id = '${org}' limit 1` as never)).rows[0];
      await expect(recordPayment(growActor, { invoiceId: inv.id, amount: "1", method: "CASH", paidOn: addDays(todayIn(), 30) })).rejects.toThrow(/in the future/);
    });

    it("knows a California store's day", async () => {
      expect(await facilityToday(caStore)).toBe(todayIn("America/Los_Angeles"));
    });
  });

  describe("facility access", () => {
    const token = (facilityId: string) => {
      const iat = Math.floor(Date.now() / 1000);
      return new SignJWT({ userId: budId, orgId: org, facilityId, role: "BUDTENDER", name: "Bo Bud" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(iat)
        .setExpirationTime(iat + 3600)
        .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    };
    const ownerSession = () => ({ userId: ownerId, orgId: org, facilityId: store, name: "Oz Owner", role: "OWNER" as const, customRoleId: null, permissions: [], roleName: "Owner" });

    it("keeps someone limited to one store inside it, and owners can't be limited", async () => {
      const prev = process.env.OPEN_ACCESS;
      process.env.OPEN_ACCESS = "1";
      try {
        const owner = { ...ownerSession(), permissions: (await import("@/lib/rbac")).permissionsFor("OWNER") };
        await setUserFacilities(owner, budId, [store]);
        const s = await sessionFromToken(await token(grow));
        expect(s?.facilityId).toBe(store);
        expect(s?.facilityIds).toEqual([store]);
        await expect(setUserFacilities(owner, ownerId, [store])).rejects.toThrow(/own role or access|every facility/);
        await setUserFacilities(owner, budId, []);
        expect((await sessionFromToken(await token(grow)))?.facilityId).toBe(grow);
      } finally {
        process.env.OPEN_ACCESS = prev;
      }
    });
  });
});
