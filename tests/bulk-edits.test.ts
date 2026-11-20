import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, customers, destinations, facilities, itemCategories, items, organizations, retailPrices, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { BULK_MAX } from "@/lib/assistant/bulk-tools";
import { TOOLS, toolsFor } from "@/lib/assistant/tools";
import { updateItems } from "@/lib/bulk-items";
import { addDays, todayIn } from "@/lib/distribution-math";
import { createCustomer, createDestination, createOrder, updateDestinations, updateVendors, verifyDestinationLicense } from "@/lib/distribution";
import type { Actor } from "@/lib/inventory";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `BLK${Date.now().toString(36)}`;
type Propose = { propose: (s: Session, i: Record<string, unknown>) => Promise<{ title: string; details: { label: string; value: string }[]; action: { args: Record<string, string> } }>; execute: (a: Actor, args: Record<string, string>) => Promise<string> };
const tool = (name: string) => TOOLS.find((t) => t.name === name) as unknown as Propose;

describe.skipIf(!hasDb)("vendors, destinations, and bulk edits (database)", () => {
  let actor: Actor;
  let other: Actor;
  let session: (role: Role) => Session;
  let jarIds: string[];

  beforeAll(async () => {
    const [org, org2] = await db.insert(organizations).values([{ name: `Bulk ${run}` }, { name: `Other ${run}` }]).returning();
    const [fac, fac2] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "Shop", licenseNumber: `${run}-F`, licenseType: "RETAIL", state: "NM" },
        { orgId: org2.id, name: "Shop2", licenseNumber: `${run}-G`, licenseType: "RETAIL", state: "NM" },
      ])
      .returning();
    const [u, u2] = await db
      .insert(users)
      .values([
        { orgId: org.id, name: "Bo Bulk", email: `bo-${run}@t.invalid`, passwordHash: "x", role: "OWNER" },
        { orgId: org2.id, name: "Ot Her", email: `ot-${run}@t.invalid`, passwordHash: "x", role: "OWNER" },
      ])
      .returning();
    actor = { userId: u.id, userName: u.name, orgId: org.id, facilityId: fac.id };
    other = { userId: u2.id, userName: u2.name, orgId: org2.id, facilityId: fac2.id };
    session = (role) => ({ userId: u.id, orgId: org.id, facilityId: fac.id, name: u.name, role, permissions: permissionsFor(role), roleName: role, customRoleId: null });
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Pre-rolls" }).returning();
    const made = await db
      .insert(items)
      .values(["Haze 1g Pre-roll", "Kush 1g Pre-roll", "Mesa 1g Pre-roll", "Gummies 10pk"].map((name, i) => ({ orgId: org.id, name, sku: `${run}-${i}`, categoryId: cat.id, unit: "EACH" as const })))
      .returning();
    jarIds = made.slice(0, 3).map((m) => m.id);
  });
  afterAll(() => pool.end());

  it("a new vendor gets its own location as its first destination; orders ship to a chosen, active destination", async () => {
    const v = await createCustomer(actor, { name: "Canyon Co", licenseNumber: `${run}-V1`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 100), weBuyFrom: true });
    const [first] = await db.select().from(destinations).where(eq(destinations.vendorId, v.id));
    expect(first).toMatchObject({ name: "Canyon Co", licenseNumber: `${run}-V1`.toUpperCase() });
    const second = await createDestination(actor, { vendorId: v.id, name: "Canyon – East", licenseNumber: `${run}-V1E`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 50) });
    await expect(createDestination(actor, { vendorId: v.id, name: "Dup", licenseNumber: `${run}-v1e`, licenseType: "Retailer", licenseExpires: "2030-01-01" })).rejects.toThrow(/already has a destination/);
    const order = await createOrder(actor, { customerId: v.id, destinationId: second.id });
    expect(order.destinationId).toBe(second.id);
    expect((await createOrder(actor, { customerId: v.id })).destinationId).toBe(first.id); // default: first active
    await updateDestinations(actor, [second.id], { active: false });
    await expect(createOrder(actor, { customerId: v.id, destinationId: second.id })).rejects.toThrow(/inactive/);
    await expect(createCustomer(actor, { name: "Nobody", licenseNumber: `${run}-V9`, licenseType: "R", licenseExpires: "2030-01-01", weSellTo: false, weBuyFrom: false })).rejects.toThrow(/Check at least one/);
  });

  it("bulk-edits vendors and destinations, all or nothing, with an audit entry for each and no reach into other businesses", async () => {
    const a = await createCustomer(actor, { name: "Alpha Retail", licenseNumber: `${run}-A`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 100) });
    const b = await createCustomer(actor, { name: "Beta Retail", licenseNumber: `${run}-B`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 100) });
    const theirs = await createCustomer(other, { name: "Not Yours", licenseNumber: `${run}-Z`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 100) });
    expect(await updateVendors(actor, [a.id, b.id], { paymentTermsDays: 30, weBuyFrom: true })).toBe(2);
    const rows = await db.select().from(customers).where(sql`${customers.id} in (${a.id}, ${b.id})`);
    expect(rows.every((r) => r.paymentTermsDays === 30 && r.weBuyFrom)).toBe(true);
    await expect(updateVendors(actor, [a.id, theirs.id], { paymentTermsDays: 7 })).rejects.toThrow(/no longer exists. Nothing was changed/);
    expect((await db.select().from(customers).where(eq(customers.id, a.id)))[0].paymentTermsDays).toBe(30);
    await expect(updateVendors(actor, [a.id], { weSellTo: false, weBuyFrom: false })).rejects.toThrow(/sell to, buy from, or both/);
    expect(await db.$count(auditLogs, and(eq(auditLogs.entityType, "Vendor"), eq(auditLogs.action, "UPDATE"), eq(auditLogs.orgId, actor.orgId)))).toBeGreaterThanOrEqual(2);

    // A new expiry date clears the verification, so the license must be checked again before shipping.
    const [d] = await db.select().from(destinations).where(eq(destinations.vendorId, a.id));
    await verifyDestinationLicense(actor, { destinationId: d.id });
    await updateDestinations(actor, [d.id], { licenseExpires: addDays(todayIn(), 300), address: "1 Main St" });
    expect((await db.select().from(destinations).where(eq(destinations.id, d.id)))[0]).toMatchObject({ address: "1 Main St", licenseVerifiedAt: null });
  });

  it("bulk-edits items: category (made if new), archive, limits, and shelf prices at this facility", async () => {
    expect(await updateItems(actor, jarIds, { category: "Joints", limitCategory: "FLOWER", limitPerUnit: "1" })).toBe(3);
    const after = await db.select({ name: itemCategories.name, lc: items.limitCategory, lpu: items.limitPerUnit }).from(items).innerJoin(itemCategories, eq(itemCategories.id, items.categoryId)).where(sql`${items.id} in ${jarIds}`);
    expect(after.every((r) => r.name === "Joints" && r.lc === "FLOWER" && Number(r.lpu) === 1)).toBe(true);
    await updateItems(actor, jarIds, { retailPrice: "9.5" });
    expect((await db.select().from(retailPrices).where(eq(retailPrices.facilityId, actor.facilityId))).map((p) => p.price).sort()).toEqual(["9.5000", "9.5000", "9.5000"]);
    await expect(updateItems(actor, jarIds, { retailPrice: "0" })).rejects.toThrow(/more than zero/);
    await expect(updateItems(other, jarIds, { active: false })).rejects.toThrow(/no longer exists/);
  });

  it("Tally proposes one card for a bulk change, applies it on confirm, and only to people allowed", async () => {
    const owner = session("OWNER");
    const p = await tool("bulk_edit_items").propose(owner, { match: { name_contains: "pre-roll" }, changes: { strain: "House blend" } });
    expect(p.title).toBe("Change 3 items");
    expect(p.details[0].value).toContain("Haze 1g Pre-roll");
    expect(p.details).toContainEqual({ label: "Strain", value: "→ House blend" });
    expect(await tool("bulk_edit_items").execute(actor, p.action.args)).toBe("Updated 3 items.");
    expect((await db.select({ s: items.strain }).from(items).where(sql`${items.id} in ${jarIds}`)).every((r) => r.s === "House blend")).toBe(true);
    await expect(tool("bulk_edit_items").propose(owner, { match: {}, changes: { strain: "x" } })).rejects.toThrow(/Say which items/);
    await expect(tool("bulk_edit_items").propose(owner, { match: { name_contains: "nothing-like-this" }, changes: { strain: "x" } })).rejects.toThrow(/No items match/);

    const vendorCard = await tool("bulk_edit_vendors").propose(owner, { match: { name_contains: "retail" }, changes: { payment_terms_days: 45 } });
    expect(vendorCard.title).toBe("Change 2 vendors");
    const destCard = await tool("bulk_edit_destinations").propose(owner, { match: { vendor: "Canyon" }, changes: { phone: "505-555-0100" }, });
    expect(destCard.title).toMatch(/Change 1 destination/); // the inactive one is left out

    const names = (r: Role) => toolsFor(session(r)).map((t) => t.name);
    expect(names("OWNER")).toEqual(expect.arrayContaining(["bulk_edit_items", "bulk_set_prices", "bulk_edit_vendors", "bulk_edit_destinations"]));
    expect(names("BUDTENDER")).not.toContain("bulk_edit_items");
    expect(names("BUDTENDER")).not.toContain("bulk_edit_vendors");
    expect(names("SALES")).toContain("bulk_edit_vendors");
    expect(names("SALES")).not.toContain("bulk_set_prices");
  });

  it(`refuses to change more than ${BULK_MAX} records in one go`, async () => {
    const [cat] = await db.insert(itemCategories).values({ orgId: actor.orgId, name: "Many" }).returning();
    await db.insert(items).values(Array.from({ length: BULK_MAX + 1 }, (_, i) => ({ orgId: actor.orgId, name: `Bulk thing ${i}`, sku: `${run}-M${i}`, categoryId: cat.id, unit: "EACH" as const })));
    await expect(tool("bulk_edit_items").propose(session("OWNER"), { match: { category: "Many" }, changes: { active: false } })).rejects.toThrow(/more than the 200/);
  });
});
