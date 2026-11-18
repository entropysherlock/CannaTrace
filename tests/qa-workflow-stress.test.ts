import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, facilities, itemCategories, items, locations, orders, organizations, packages, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addOrderLine, allocateToOrder, confirmOrder, createCustomer, createOrder, verifyCustomerLicense } from "@/lib/distribution";
import { addDays, todayIn } from "@/lib/distribution-math";
import { receivePackage, type Actor } from "@/lib/inventory";

const hasDb = Boolean(process.env.DATABASE_URL);
const seed = "QA" + Date.now().toString(36).toUpperCase();
let seller: Actor;
let outsider: Actor;
let customerId: string;
let itemId: string;
let locationId: string;

describe.skipIf(!hasDb)("CannaTrace isolated workflow stress tests", () => {
  beforeAll(async () => {
    const [orgA, orgB] = await db.insert(organizations).values([{ name: seed + " Store" }, { name: seed + " Other Tenant" }]).returning();
    const [facilityA, facilityB] = await db.insert(facilities).values([
      { orgId: orgA.id, name: "QA Store", licenseNumber: seed + "-A", licenseType: "DISTRIBUTION", state: "NM" },
      { orgId: orgB.id, name: "Other Tenant Store", licenseNumber: seed + "-B", licenseType: "DISTRIBUTION", state: "NM" },
    ]).returning();
    const [userA, userB] = await db.insert(users).values([
      { orgId: orgA.id, name: "QA Warehouse Manager", email: seed.toLowerCase() + "a@test.invalid", passwordHash: "x", role: "MANAGER" },
      { orgId: orgB.id, name: "QA Outside User", email: seed.toLowerCase() + "b@test.invalid", passwordHash: "x", role: "MANAGER" },
    ]).returning();
    seller = { orgId: orgA.id, facilityId: facilityA.id, userId: userA.id, userName: userA.name };
    outsider = { orgId: orgB.id, facilityId: facilityB.id, userId: userB.id, userName: userB.name };
    const [category] = await db.insert(itemCategories).values({ orgId: orgA.id, name: "QA Goods" }).returning();
    const [item] = await db.insert(items).values({ orgId: orgA.id, name: "QA Jar", sku: seed + "-JAR", categoryId: category.id, unit: "EACH" }).returning();
    itemId = item.id;
    const [location] = await db.insert(locations).values({ orgId: orgA.id, facilityId: facilityA.id, name: "QA Vault", type: "ROOM" }).returning();
    locationId = location.id;
    const customer = await createCustomer(seller, { name: "QA Wholesale Buyer", licenseNumber: seed + "-C", licenseType: "Retailer", licenseExpires: addDays(todayIn(), 365), paymentTermsDays: "30" });
    customerId = customer.id;
    await verifyCustomerLicense(seller, { customerId });
  });

  afterAll(async () => { await pool.end(); });

  it("creates uniquely numbered orders during twelve simultaneous employee submissions", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => createOrder(seller, { customerId, notes: "QA parallel order " + i })));
    const successes = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrder>>> => r.status === "fulfilled");
    const numbers = successes.map((r) => r.value.number);
    expect(successes.length).toBe(12);
    expect(new Set(numbers).size).toBe(12);
    const total = await db.$count(orders, and(eq(orders.orgId, seller.orgId), eq(orders.facilityId, seller.facilityId)));
    expect(total).toBe(12);
  });

  it("does not permit another business to add lines or confirm our draft order", async () => {
    const order = await createOrder(seller, { customerId });
    await expect(addOrderLine(outsider, { orderId: order.id, itemId, quantity: "1", unitPrice: "12" })).rejects.toThrow();
    await expect(confirmOrder(outsider, { orderId: order.id })).rejects.toThrow();
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("DRAFT");
  });

  it("prevents two simultaneous wholesale orders allocating the same package", async () => {
    const stock = await receivePackage(seller, { tag: seed + "-STOCK", itemId, quantity: "10", locationId });
    const [first, second] = await Promise.all([createOrder(seller, { customerId }), createOrder(seller, { customerId })]);
    for (const order of [first, second]) {
      await addOrderLine(seller, { orderId: order.id, itemId, quantity: "10", unitPrice: "12" });
      await confirmOrder(seller, { orderId: order.id });
    }
    const findLine = async (orderId: string) => {
      const rows = await db.execute<{ id: string }>(sql`select id from order_lines where order_id = ${orderId}`);
      return rows.rows[0].id;
    };
    const [lineA, lineB] = await Promise.all([findLine(first.id), findLine(second.id)]);
    const results = await Promise.allSettled([
      allocateToOrder(seller, { orderId: first.id, lineId: lineA, tag: stock.tag }),
      allocateToOrder(seller, { orderId: second.id, lineId: lineB, tag: stock.tag }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [current] = await db.select().from(packages).where(eq(packages.id, stock.id));
    expect(current.status).toBe("ALLOCATED");
    expect(current.quantity).toBe("10.0000");
    const allocations = await db.execute<{ n: number }>(sql`select count(*)::int as n from order_allocations where package_id = ${stock.id}`);
    expect(allocations.rows[0].n).toBe(1);
  });
});
