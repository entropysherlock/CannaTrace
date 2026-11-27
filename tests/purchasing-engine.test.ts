import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packages, purchaseOrderLines, purchaseOrders, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { createCustomer } from "@/lib/distribution";
import { addDays, todayIn } from "@/lib/distribution-math";
import type { Actor } from "@/lib/inventory";
import {
  addPurchaseOrderLine,
  changePurchaseOrder,
  createPurchaseOrder,
  importPurchaseOrder,
  receivePurchaseOrder,
  receiveWholePurchaseOrder,
  removePurchaseOrderLine,
} from "@/lib/purchasing";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `P${Date.now().toString(36).toUpperCase()}`;

let actor: Actor;
let jars: string;
let flower: string;
let vault: string;
let vendorId: string;
let sellOnlyId: string;

const po = async (id: string) => (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)))[0];
const lines = async (id: string) => db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));

describe.skipIf(!hasDb)("purchase orders (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `PO Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-F`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Buyer", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Vault", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db
      .insert(items)
      .values([
        { orgId: org.id, name: "Blue Mesa 3.5 g Jar", sku: `${run}-JAR`, categoryId: category.id, unit: "EACH" },
        { orgId: org.id, name: "Blue Mesa Flower", sku: `${run}-FLW`, categoryId: category.id, unit: "G" },
      ])
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    [jars, flower] = made.map((i) => i.id);
    vault = location.id;
    vendorId = (await createCustomer(actor, { name: "Green Valley", licenseNumber: `${run}-V`, licenseType: "Producer", licenseExpires: addDays(todayIn(), 200), weBuyFrom: true })).id;
    sellOnlyId = (await createCustomer(actor, { name: "Shop Only", licenseNumber: `${run}-S`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 200) })).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("only orders from a vendor you buy from", async () => {
    await expect(createPurchaseOrder(actor, { vendorId: sellOnlyId })).rejects.toThrow(/buy from/);
  });

  it("orders, sends, receives part, then the rest, with cost and vendor on each package", async () => {
    const p = await createPurchaseOrder(actor, { vendorId, expectedOn: addDays(todayIn(), 3) });
    expect(p.number).toMatch(/^PO-\d{5}$/);
    await expect(changePurchaseOrder(actor, { purchaseOrderId: p.id, step: "send" })).rejects.toThrow(/at least one line/);
    await addPurchaseOrderLine(actor, { purchaseOrderId: p.id, itemId: jars, quantity: "100", unitCost: "12.50" });
    await addPurchaseOrderLine(actor, { purchaseOrderId: p.id, itemId: flower, quantity: "500" });
    await expect(addPurchaseOrderLine(actor, { purchaseOrderId: p.id, itemId: jars, quantity: "1" })).rejects.toThrow(/already on this purchase order/);
    await expect(addPurchaseOrderLine(actor, { purchaseOrderId: p.id, itemId: jars, quantity: "1.5" })).rejects.toThrow();
    expect((await changePurchaseOrder(actor, { purchaseOrderId: p.id, step: "send" })).status).toBe("SENT");

    const [jarLine, flowerLine] = (await lines(p.id)).sort((a, b) => (a.itemId === jars ? -1 : b.itemId === jars ? 1 : 0));
    await expect(receivePurchaseOrder(actor, { purchaseOrderId: p.id, locationId: vault, lines: [{ lineId: jarLine.id, quantity: "101" }] })).rejects.toThrow(/more than the 100/);

    const first = await receivePurchaseOrder(actor, { purchaseOrderId: p.id, locationId: vault, lines: [{ lineId: jarLine.id, quantity: "60", tag: `${run}-T1`, lotNumber: "L1" }, { lineId: flowerLine.id, quantity: "" }] });
    expect(first.po.status).toBe("PARTIAL");
    expect(first.packages).toHaveLength(1);
    const [made] = await db.select().from(packages).where(eq(packages.id, first.packages[0].id));
    expect(made.tag).toBe(`${run}-T1`);
    expect(made.vendorId).toBe(vendorId);
    expect(new Decimal(made.costPerUnit!).toString()).toBe("12.5");
    expect(made.lotNumber).toBe("L1");
    await expect(removePurchaseOrderLine(actor, { lineId: jarLine.id })).rejects.toThrow();
    await expect(changePurchaseOrder(actor, { purchaseOrderId: p.id, step: "cancel" })).rejects.toThrow(/close it short/);

    const rest = await receiveWholePurchaseOrder(actor, { purchaseOrderId: p.id, locationId: vault });
    expect(rest.packages).toHaveLength(2);
    expect(rest.po.status).toBe("RECEIVED");
    expect((await lines(p.id)).every((l) => new Decimal(l.quantity).eq(l.quantityReceived))).toBe(true);
    await expect(receiveWholePurchaseOrder(actor, { purchaseOrderId: p.id, locationId: vault })).rejects.toThrow();
  });

  it("closes short and cancels", async () => {
    const p = await createPurchaseOrder(actor, { vendorId });
    await addPurchaseOrderLine(actor, { purchaseOrderId: p.id, itemId: jars, quantity: "10" });
    await receivePurchaseOrder(actor, { purchaseOrderId: p.id, locationId: vault, lines: [{ lineId: (await lines(p.id))[0].id, quantity: "4" }] });
    expect((await po(p.id)).status).toBe("PARTIAL");
    expect((await changePurchaseOrder(actor, { purchaseOrderId: p.id, step: "close" })).status).toBe("RECEIVED");

    const q = await createPurchaseOrder(actor, { vendorId });
    expect((await changePurchaseOrder(actor, { purchaseOrderId: q.id, step: "cancel" })).status).toBe("CANCELLED");
    await expect(addPurchaseOrderLine(actor, { purchaseOrderId: q.id, itemId: jars, quantity: "1" })).rejects.toThrow(/cancelled/);
  });

  it("imports a PO from CSV by SKU or name, all or nothing", async () => {
    const bad = `sku,item,quantity,unit cost\n${run}-JAR,,10,5\n,No Such Thing,3,\n`;
    await expect(importPurchaseOrder(actor, { vendorId, csv: bad })).rejects.toThrow(/Row 3/);
    const good = `SKU,Item,Quantity,Unit Cost\n${run}-JAR,,10,$5.25\n,blue mesa flower,250,\n`;
    const { po: made, lines: n } = await importPurchaseOrder(actor, { vendorId, csv: good });
    expect(n).toBe(2);
    expect(made.status).toBe("DRAFT");
    const got = await lines(made.id);
    expect(got.map((l) => new Decimal(l.quantity).toString()).sort()).toEqual(["10", "250"]);
    expect(new Decimal(got.find((l) => l.itemId === jars)!.unitCost!).toString()).toBe("5.25");
  });
});
