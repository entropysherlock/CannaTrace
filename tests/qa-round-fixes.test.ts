import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLogs,
  drivers,
  facilities,
  harvests,
  itemCategories,
  items,
  labResults,
  locations,
  organizations,
  packages,
  sales,
  strains,
  users,
  vehicles,
  watchFindings,
} from "@/db/schema";
import { db, pool } from "@/lib/db";
import { commandCenter } from "@/lib/dashboard";
import { importCsv } from "@/lib/importer";
import { createApiKey, createWebhook, revokeApiKey, setWebhookActive } from "@/lib/integrations";
import { setFacilitySystem } from "@/lib/sync";
import { describeEvent } from "@/lib/sync-math";
import { actionLabel, changedFields, entityLabel, recordName } from "@/lib/audit-format";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addOrderLine, allocateToOrder, confirmOrder, createCustomer, createDriver, createOrder, createVehicle, deliverOrder, packOrder, shipOrder, verifyCustomerLicense } from "@/lib/distribution";
import {
  addLabResult,
  latestLabStatus,
  mergePackages,
  movePackage,
  receivePackage,
  recordCycleCount,
  setPackageStatus,
  splitPackage,
  type Actor,
} from "@/lib/inventory";
import { finishHarvest, packageFromHarvest, recordDryWeight, reopenHarvest } from "@/lib/cultivation";
import { addToCart, checkInCustomer, closeDrawer, completeSale, openDrawer, returnableLines, returnSale, saveRetailSettings, sellableByItem, setMenuItem, storePack, voidSale } from "@/lib/pos";
import { saleLines, apiKeys } from "@/db/schema";
import { receiveShipment } from "@/lib/shipments";
import { requiresLabBeforeRetail } from "@/lib/rules";
import { clearSignInFailures, MAX_PER_EMAIL, recordSignInFailure, signInLocked } from "@/lib/sign-in-throttle";

/**
 * Regression tests for the bugs found by the three-tester QA round (November 19, 2026): failed lab results
 * hidden by a pending one, purchase limits wiped by a price change, voids after returns, facility leaks,
 * own-facility transfers, empty harvests, strain mix-ups, fractional counts and returns, other people's carts,
 * and password guessing.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `QA${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(3, "0")}`;

describe.skipIf(!hasDb)("QA round fixes (database)", () => {
  let org: string;
  let store: string;
  let grow: string;
  let hidden: string;
  let manager: Actor;
  let bud: Actor;
  let growActor: Actor;
  let jar: string;
  let bulk: string;
  let blueMesaFlower: string;
  let vault: string;
  let floor: string;
  let blueMesa: string;
  let desertHaze: string;

  const pkg = async (id: string) => (await db.select().from(packages).where(eq(packages.id, id)))[0];
  const adult = () => ({ birthDate: "1985-01-01", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" });

  beforeAll(async () => {
    const [o] = await db.insert(organizations).values({ name: `QA ${run}` }).returning();
    org = o.id;
    const made = await db
      .insert(facilities)
      .values([
        { orgId: org, name: "Store", licenseNumber: `${run}-S`, licenseType: "RETAIL", state: "NM" },
        { orgId: org, name: "Grow", licenseNumber: `${run}-G`, licenseType: "CULTIVATION", state: "NM" },
        { orgId: org, name: "Old site", licenseNumber: `${run}-H`, licenseType: "RETAIL", state: "NM", active: false },
      ])
      .returning();
    [store, grow, hidden] = made.map((f) => f.id);
    const people = await db
      .insert(users)
      .values([
        { orgId: org, name: "Mia Manager", email: `m-${run}@t.invalid`, passwordHash: "x", role: "MANAGER" as const },
        { orgId: org, name: "Bo Bud", email: `b-${run}@t.invalid`, passwordHash: "x", role: "BUDTENDER" as const },
      ])
      .returning();
    manager = { userId: people[0].id, userName: people[0].name, orgId: org, facilityId: store };
    bud = { userId: people[1].id, userName: people[1].name, orgId: org, facilityId: store };
    growActor = { ...manager, facilityId: grow };
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
        { orgId: org, name: "Blue Mesa Flower", sku: `${run}-BMF`, categoryId: cat.id, unit: "G" as const, strain: "Blue Mesa" },
      ])
      .returning();
    [jar, bulk, blueMesaFlower] = its.map((i) => i.id);
    const st = await db
      .insert(strains)
      .values([
        { orgId: org, name: "Blue Mesa", type: "HYBRID" as const },
        { orgId: org, name: "Desert Haze", type: "SATIVA" as const },
      ])
      .returning();
    [blueMesa, desertHaze] = st.map((s) => s.id);
    await saveRetailSettings(manager, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "7.5", medicalTaxExempt: true });
    await setMenuItem(manager, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
  });
  afterAll(() => pool.end());

  describe("1 and 8: a failed lab test stands", () => {
    it("isn't cleared by a later pending result; only a pass releases it", async () => {
      const p = await receivePackage(growActor, { tag: tag(), itemId: bulk, quantity: "100", locationId: vault });
      await addLabResult(growActor, { packageId: p.id, labName: "Lab", status: "FAIL" });
      await addLabResult(growActor, { packageId: p.id, labName: "Lab", status: "PENDING" });
      expect(await db.transaction((tx) => latestLabStatus(tx, p.id))).toBe("FAIL");
      await expect(setPackageStatus(growActor, { packageId: p.id, status: "ACTIVE", reason: "pending retest" })).rejects.toThrow(/failed its most recent lab test/);
      await addLabResult(growActor, { packageId: p.id, labName: "Lab", status: "PASS" });
      await setPackageStatus(growActor, { packageId: p.id, status: "ACTIVE", reason: "retest passed" });
      expect((await pkg(p.id)).status).toBe("ACTIVE");
    });

    it("quarantines packages already made from it, and blocks splitting or merging failed product", async () => {
      const p = await receivePackage(growActor, { tag: tag(), itemId: bulk, quantity: "100", locationId: vault });
      const { children } = await splitPackage(growActor, { packageId: p.id, parts: [{ quantity: "30" }, { quantity: "20" }] });
      // Recorded straight in the table, so neither the parent nor its parts are quarantined yet.
      await db.insert(labResults).values({ orgId: org, facilityId: grow, packageId: p.id, labName: "Lab", status: "FAIL", userId: manager.userId });
      await expect(splitPackage(growActor, { packageId: children[0].id, parts: [{ quantity: "5" }] })).rejects.toThrow(/cannot be split/);
      await expect(mergePackages(growActor, { sourceIds: [children[0].id, children[1].id] })).rejects.toThrow(/cannot be merged/);

      // Recording the failure the normal way holds every package made from it.
      const q = await receivePackage(growActor, { tag: tag(), itemId: bulk, quantity: "50", locationId: vault });
      const { children: parts } = await splitPackage(growActor, { packageId: q.id, parts: [{ quantity: "10" }] });
      await addLabResult(growActor, { packageId: q.id, labName: "Lab", status: "FAIL" });
      expect((await pkg(q.id)).status).toBe("QUARANTINE");
      expect((await pkg(parts[0].id)).status).toBe("QUARANTINE");
      const lab = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, q.id), eq(auditLogs.action, "LAB_RESULT")));
      expect(lab[0].after).toMatchObject({ tag: q.tag, status: "FAIL" });
    });
  });

  describe("2: a price change keeps the purchase limit", () => {
    it("leaves the item's limit alone unless one is chosen, and refuses odd prices", async () => {
      await setMenuItem(manager, { itemId: jar, price: "40", limitCategory: "KEEP" });
      const [it] = await db.select().from(items).where(eq(items.id, jar));
      expect(it.limitCategory).toBe("FLOWER");
      expect(Number(it.limitPerUnit)).toBe(3.5);
      await expect(setMenuItem(manager, { itemId: jar, price: "10.999", limitCategory: "KEEP" })).rejects.toThrow(/fractions of a cent/);
      await expect(setMenuItem(manager, { itemId: jar, price: "99999999999", limitCategory: "KEEP" })).rejects.toThrow(/can't be more than/);
      await setMenuItem(manager, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    });
  });

  describe("the register", () => {
    let stock: string;
    beforeAll(async () => {
      stock = (await receivePackage(manager, { tag: tag(), itemId: jar, quantity: "200", locationId: floor })).id;
      await addLabResult(manager, { packageId: stock, labName: "Lab", status: "PASS" });
      await openDrawer(manager, { openingCash: "100" });
      await openDrawer(bud, { openingCash: "100" });
    });

    it("3: won't void a sale that already has a return, so nothing is restocked twice", async () => {
      const cart = await checkInCustomer(manager, adult());
      await addToCart(manager, { saleId: cart.id, itemId: jar, quantity: "4" });
      await completeSale(manager, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "500" });
      const [line] = await returnableLines(db, cart.id);
      await returnSale(manager, { saleId: cart.id, lines: [{ saleLineId: line.saleLineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "changed mind" });
      const before = Number((await pkg(stock)).quantity);
      await expect(voidSale(manager, { saleId: cart.id, reason: "oops" })).rejects.toThrow(/already has a return/);
      expect(Number((await pkg(stock)).quantity)).toBe(before);
    });

    it("10: refuses returning part of a counted item", async () => {
      const cart = await checkInCustomer(manager, adult());
      await addToCart(manager, { saleId: cart.id, itemId: jar, quantity: "2" });
      await completeSale(manager, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "500" });
      const [line] = await returnableLines(db, cart.id);
      await expect(
        returnSale(manager, { saleId: cart.id, lines: [{ saleLineId: line.saleLineId, quantity: "0.5" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "half" }),
      ).rejects.toThrow(/whole number/);
    });

    it("12: moves someone else's cart to your drawer before you take payment, and closing their drawer says so", async () => {
      const cart = await checkInCustomer(bud, adult());
      await addToCart(bud, { saleId: cart.id, itemId: jar, quantity: "1" });
      await expect(closeDrawer(manager, { drawerId: cart.drawerSessionId, countedCash: "100" })).rejects.toThrow(/on Bo Bud's drawer.*take .* over from Held carts/);
      await completeSale(manager, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "100" });
      const [done] = await db.select().from(sales).where(eq(sales.id, cart.id));
      expect(done.drawerSessionId).not.toBe(cart.drawerSessionId);
      expect(done.userName).toBe("Mia Manager");
      const moved = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, cart.id), eq(auditLogs.action, "TAKE_OVER")));
      expect(moved).toHaveLength(1);
    });
  });

  describe("11: cycle counts", () => {
    it("refuse fractions of a counted item", async () => {
      const p = await receivePackage(growActor, { tag: tag(), itemId: jar, quantity: "50", locationId: vault });
      await expect(recordCycleCount(growActor, { locationId: vault, counts: [{ packageId: p.id, counted: "49.5" }] })).rejects.toThrow(/whole number/);
      expect(Number((await pkg(p.id)).quantity)).toBe(50);
    });
  });

  describe("7 and 9: harvests", () => {
    const harvest = async (strainId: string) =>
      (
        await db
          .insert(harvests)
          .values({ orgId: org, facilityId: grow, name: tag(), strainId, wetWeight: "500", harvestedAt: new Date(), userId: manager.userId, locationId: vault, plantCount: 2 })
          .returning()
      )[0];

    it("can't be finished without a dry weight, and can be reopened", async () => {
      const h = await harvest(blueMesa);
      await expect(finishHarvest(growActor, { harvestId: h.id })).rejects.toThrow(/Record the dry weight first/);
      await recordDryWeight(growActor, { harvestId: h.id, dryWeight: "100", unit: "G" });
      await packageFromHarvest(growActor, { harvestId: h.id, tag: tag(), itemId: blueMesaFlower, quantity: "100", locationId: vault });
      await finishHarvest(growActor, { harvestId: h.id });
      await reopenHarvest(growActor, { harvestId: h.id, reason: "finished by mistake" });
      expect((await db.select().from(harvests).where(eq(harvests.id, h.id)))[0].status).toBe("DRYING");
    });

    it("can't be packaged as another strain's item", async () => {
      const h = await harvest(desertHaze);
      await recordDryWeight(growActor, { harvestId: h.id, dryWeight: "100", unit: "G" });
      await expect(packageFromHarvest(growActor, { harvestId: h.id, tag: tag(), itemId: blueMesaFlower, quantity: "10", locationId: vault })).rejects.toThrow(
        /Blue Mesa Flower is Blue Mesa, but this harvest is Desert Haze/,
      );
      // An item with no strain set (mixed trim and the like) is still fine.
      await packageFromHarvest(growActor, { harvestId: h.id, tag: tag(), itemId: bulk, quantity: "10", locationId: vault });
    });
  });

  describe("6: a shipment from one of our own facilities", () => {
    it("is taken in at the store as the same package, and other tags are still refused", async () => {
      const c = await createCustomer(growActor, { name: "Our store", licenseNumber: `${run}-S`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 300) });
      await verifyCustomerLicense(growActor, { customerId: c.id });
      await createDriver(growActor, { name: "Dee", licenseNumber: "D-1" });
      await createVehicle(growActor, { make: "Ford", model: "Van", plate: run.slice(0, 8) });
      const driverId = (await db.select().from(drivers).where(eq(drivers.orgId, org)))[0].id;
      const vehicleId = (await db.select().from(vehicles).where(eq(vehicles.orgId, org)))[0].id;

      const p = await receivePackage(growActor, { tag: tag(), itemId: jar, quantity: "10", locationId: vault });
      await addLabResult(growActor, { packageId: p.id, labName: "Lab", status: "PASS" });
      const order = await createOrder(growActor, { customerId: c.id });
      await addOrderLine(growActor, { orderId: order.id, itemId: jar, quantity: "10", unitPrice: "10" });
      await confirmOrder(growActor, { orderId: order.id });
      const lineId = (await db.execute<{ id: string }>(`select id from order_lines where order_id = '${order.id}'` as never)).rows[0].id;
      await allocateToOrder(growActor, { orderId: order.id, lineId, tag: p.tag });
      await packOrder(growActor, { orderId: order.id });
      const { manifestNumber } = await shipOrder(growActor, { orderId: order.id, driverId, vehicleId, departAt: new Date(Date.now() + 3_600_000).toISOString() });
      await deliverOrder(growActor, { orderId: order.id, receivedBy: "Mia" });
      expect((await pkg(p.id)).status).toBe("FINISHED");

      const table = [
        ["Package Tag", "Item Name", "Quantity", "Lot"],
        [p.tag, "Jar", "10", ""],
      ];
      // A different manifest number doesn't unlock the tag.
      const wrong = await receiveShipment(manager, { manifestNumber: "NOT-OURS", table, locationId: floor, received: {}, commit: false });
      expect(wrong.problems).toEqual([expect.stringMatching(/already in CannaTrace/)]);

      const result = await receiveShipment(manager, { manifestNumber, table, locationId: floor, received: { [p.tag]: { quantity: "9", reason: "one jar crushed" } }, commit: true });
      expect(result.received).toBe(true);
      const after = await pkg(p.id);
      expect(after).toMatchObject({ facilityId: store, locationId: floor, status: "ACTIVE" });
      expect(Number(after.quantity)).toBe(9);
      // It keeps its lab result, so it can be sold.
      expect(await db.transaction((tx) => latestLabStatus(tx, p.id))).toBe("PASS");
      // Fractions of a counted item are caught when the manifest is checked, not only when receiving.
      const half = await receiveShipment(manager, { manifestNumber: "M-HALF", table: [["Package Tag", "Item Name", "Quantity"], [tag(), "Jar", "4.5"]], locationId: floor, received: {}, commit: false });
      expect(half.problems.join(" ")).toMatch(/whole number/);
    });
  });

  describe("5: the dashboard", () => {
    it("lists only the facilities the person may see, and only their alerts", async () => {
      await db.insert(watchFindings).values({ orgId: org, facilityId: hidden, key: `x-${run}`, check: "test", severity: "critical", title: "Hidden site alert", detail: "x", permission: null });
      const c = await commandCenter(org, [store], 30, () => true, [store, grow]);
      expect(c.facilities.map((f) => f.name).sort()).toEqual(["Grow", "Store"]);
      expect(JSON.stringify(c)).not.toContain("Hidden site alert");
    });
  });

  describe("14 and 15: admin changes are audited", () => {
    it("records state-system changes, API keys, and webhooks, with no secret in the entry", async () => {
      await setFacilitySystem(growActor, { system: "NMS2S" });
      await setFacilitySystem(growActor, { system: "NMS2S" }); // unchanged: no entry
      const { key } = await createApiKey(growActor, { name: "Accounting", canWrite: false });
      const [made] = await db.select().from(apiKeys).where(eq(apiKeys.orgId, org));
      await revokeApiKey(growActor, { keyId: made.id });
      await createWebhook(growActor, { url: "https://example.com/hook", events: ["PACKAGE_ADJUSTED"] });
      const log = await db.select().from(auditLogs).where(and(eq(auditLogs.orgId, org), eq(auditLogs.facilityId, grow)));
      const actions = log.map((l) => `${l.entityType}:${l.action}`);
      expect(actions.filter((a) => a === "Facility:STATE_SYSTEM_CHANGE")).toHaveLength(1);
      expect(actions).toEqual(expect.arrayContaining(["ApiKey:CREATE", "ApiKey:REVOKE", "Webhook:CREATE"]));
      expect(JSON.stringify(log)).not.toContain(key);
      const hook = log.find((l) => l.entityType === "Webhook")!;
      await setWebhookActive(growActor, { webhookId: hook.entityId, active: false });
      expect(await db.$count(auditLogs, and(eq(auditLogs.entityId, hook.entityId), eq(auditLogs.action, "TURN_OFF")))).toBe(1);
    });

    it("reads as plain English on the audit trail", () => {
      expect(actionLabel("KEY_CONNECTED")).toBe("connected an AI key for");
      expect(actionLabel("facility.hidden")).toBe("hid");
      expect(actionLabel("SOMETHING_NEW")).toBe("something new");
      expect(entityLabel("TallyAI")).toBe("Tally AI");
      expect(entityLabel("PlantBatch")).toBe("plant batch");
      expect(recordName(null, { tag: "CT-1", quantity: "3" })).toBe("CT-1");
      expect(changedFields({ quantity: "5", locationId: "a" }, { quantity: "4", locationId: "b" })).toEqual([{ field: "quantity", from: "5", to: "4" }]);
    });
  });

  describe("17: state records say what to enter", () => {
    it("names the package, room, production inputs, and harvested plants", async () => {
      const p = await receivePackage(growActor, { tag: tag(), itemId: bulk, quantity: "20", locationId: vault });
      const [room] = await db.insert(locations).values({ orgId: org, facilityId: grow, name: "Cure Room", type: "ROOM" }).returning();
      await movePackage(growActor, { packageId: p.id, toLocationId: room.id });
      const [moved] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, p.id), eq(auditLogs.action, "MOVE")));
      expect(describeEvent("PACKAGE_MOVED", moved.before as never, moved.after as never)).toBe(`Moved package ${p.tag} to Cure Room`);
      expect(describeEvent("LAB_RESULT_RECORDED", null, { tag: "CT-9", status: "FAIL", labName: "SW Labs" })).toBe("Recorded a fail lab result for package CT-9 from SW Labs");
      expect(describeEvent("PACKAGE_USED_IN_PRODUCTION", { tag: "CT-9", quantity: "100", unit: "G" }, { tag: "CT-9", quantity: "30", unit: "G" })).toBe("Used 70 g of package CT-9 in production");
      expect(describeEvent("HARVEST_CREATED", null, { name: "H1", plantCount: 2, wetWeightGrams: "500", plantTags: ["P-1", "P-2"] })).toContain("(P-1, P-2)");
    });
  });

  describe("18, 19 and 21: sales numbers and the register", () => {
    it("shows today's sales net of refunds", async () => {
      const before = await commandCenter(org, [store], 7);
      const cart = await checkInCustomer(manager, adult());
      await addToCart(manager, { saleId: cart.id, itemId: jar, quantity: "2" });
      await completeSale(manager, { saleId: cart.id, paymentMethod: "CASH", cashTendered: "500" });
      const [line] = await returnableLines(db, cart.id);
      const refund = await returnSale(manager, { saleId: cart.id, lines: [{ saleLineId: line.saleLineId, quantity: "2" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "returned" });
      expect(Number(refund.amount)).toBeGreaterThan(0);
      const after = await commandCenter(org, [store], 7);
      // Sold and fully refunded today: the money taken nets to nothing, but the sale still counts as a ticket.
      expect(after.sales.today).toBeCloseTo(before.sales.today, 2);
      expect(after.sales.todayTickets).toBe(before.sales.todayTickets + 1);
    });

    it("updates an open cart to a new shelf price on its next change", async () => {
      const cart = await checkInCustomer(manager, adult());
      await addToCart(manager, { saleId: cart.id, itemId: jar, quantity: "1" });
      await setMenuItem(manager, { itemId: jar, price: "37", limitCategory: "KEEP" });
      await addToCart(manager, { saleId: cart.id, itemId: jar, quantity: "1" });
      const [l] = await db.select().from(saleLines).where(eq(saleLines.saleId, cart.id));
      expect(Number(l.unitPrice)).toBe(37);
      await setMenuItem(manager, { itemId: jar, price: "35", limitCategory: "KEEP" });
    });

    it("counts only what can be sold on the register tiles", async () => {
      const pack = await storePack(db, store);
      const before = (await sellableByItem(db, manager, pack)).get(jar)?.toNumber() ?? 0;
      await receivePackage(manager, { tag: tag(), itemId: jar, quantity: "30", locationId: floor }); // no lab result yet
      const after = (await sellableByItem(db, manager, pack)).get(jar)?.toNumber() ?? 0;
      // New Mexico requires a passing lab result before retail sale, so untested stock isn't counted as sellable.
      expect(requiresLabBeforeRetail(pack)).toBe(true);
      expect(after).toBe(before);
    });
  });

  describe("22 and 23: imports and holds", () => {
    it("matches existing locations and categories whatever their capitals, and limits name length", async () => {
      await expect(importCsv(growActor, "locations", "name,type\nVAULT,ROOM\n")).rejects.toThrow(/a location called Vault already exists/);
      await importCsv(growActor, "items", `name,sku,category,unit,strain\nTest Gummy,${run}-GUM,ALL,EACH,\n`);
      const cats = await db.select().from(itemCategories).where(eq(itemCategories.orgId, org));
      expect(cats.map((c) => c.name)).toEqual(["All"]);
      await expect(importCsv(growActor, "items", `name,sku,category,unit,strain\n${"x".repeat(200)},${run}-LONG,All,EACH,\n`)).rejects.toThrow(/keep it to 120/);
    });

    it("gives every held package a hold start, however it got there", async () => {
      const [p] = await db
        .insert(packages)
        .values({ orgId: org, facilityId: grow, tag: tag(), itemId: bulk, quantity: "5", unit: "G", locationId: vault, status: "ON_HOLD" })
        .returning();
      expect(p.heldSince).toBeInstanceOf(Date);
    });
  });

  describe("13: password guessing", () => {
    it("locks an email after too many wrong passwords, until a successful sign-in clears it", async () => {
      const email = `guess-${run}@t.invalid`;
      for (let i = 0; i < MAX_PER_EMAIL - 1; i++) await recordSignInFailure(email, null);
      expect(await signInLocked(email, null)).toBe(false);
      await recordSignInFailure(email, "203.0.113.9");
      expect(await signInLocked(email, null)).toBe(true);
      expect(await signInLocked(`other-${run}@t.invalid`, null)).toBe(false);
      await clearSignInFailures(email);
      expect(await signInLocked(email, null)).toBe(false);
    });
  });
});
