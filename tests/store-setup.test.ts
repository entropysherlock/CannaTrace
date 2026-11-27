/** The new-store checklist, and the "hold everything waiting on a lab result" query behind the inventory banner. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { facilities, itemCategories, items, locations, organizations, packages, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addLabResult, receivePackage, setPackagesStatus, type Actor } from "@/lib/inventory";
import { openDrawer, packagesWaitingOnLab, saveRetailSettings, setMenuItem, createDiscount } from "@/lib/pos";
import { isRetailStore, storeSetup } from "@/lib/store-setup";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `SS${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

describe.skipIf(!hasDb)("store setup checklist and lab hold", () => {
  let actor: Actor;
  let farm: { orgId: string; facilityId: string };
  let itemId: string;
  let loc: string;

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Setup ${run}` }).returning();
    const [shop, grow] = await db
      .insert(facilities)
      .values([
        { orgId: org.id, name: "Shop", licenseNumber: `${run}-S`, licenseType: "RETAIL" as const, state: "NM" },
        { orgId: org.id, name: "Grow", licenseNumber: `${run}-G`, licenseType: "CULTIVATION" as const, state: "NM" },
      ])
      .returning();
    const [u] = await db.insert(users).values({ orgId: org.id, name: "Owner", email: `o.${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" as const }).returning();
    actor = { userId: u.id, userName: u.name, orgId: org.id, facilityId: shop.id };
    farm = { orgId: org.id, facilityId: grow.id };
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const [it] = await db.insert(items).values({ orgId: org.id, name: `Jar ${run}`, sku: run, categoryId: cat.id, unit: "EACH" }).returning();
    itemId = it.id;
    const [l] = await db.insert(locations).values({ orgId: org.id, facilityId: shop.id, name: "Floor", type: "ROOM" as const }).returning();
    loc = l.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("is not shown for a store that isn't a retailer", async () => {
    expect(await storeSetup(farm)).toBeNull();
    // The lab-hold banner follows the same rule: a grow's packages legitimately wait on labs, so it is never offered there.
    expect(await isRetailStore(farm.orgId, farm.facilityId)).toBe(false);
    expect(await isRetailStore(actor.orgId, actor.facilityId)).toBe(true);
  });

  it("starts with the required steps open and ticks them off as the store is set up", async () => {
    const done = async () => Object.fromEntries((await storeSetup(actor))!.map((s) => [s.key, s.done]));
    let d = await done();
    expect(d).toMatchObject({ rooms: true, stock: false, labs: false, menu: false, rules: false, tax: false, drawer: false, rewards: false, discounts: false });

    const p = await receivePackage(actor, { tag: tag(), itemId, quantity: "10", locationId: loc });
    d = await done();
    expect(d.stock).toBe(true);
    expect(d.labs).toBe(false); // New Mexico needs a passing lab result before retail

    await addLabResult(actor, { packageId: p.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    await setMenuItem(actor, { itemId, price: "10", limitCategory: "NONE" });
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "0", salesTaxPercent: "0", medicalTaxExempt: true });
    d = await done();
    expect(d).toMatchObject({ labs: true, menu: true, rules: true, tax: false }); // rules saved, but zero tax still counts as not entered

    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "12", salesTaxPercent: "7.5", medicalTaxExempt: true });
    await openDrawer(actor, { openingCash: "100" });
    await createDiscount(actor, { name: "Veteran", percent: "10" });
    d = await done();
    expect(d).toMatchObject({ tax: true, drawer: true, discounts: true });
    const steps = (await storeSetup(actor))!;
    expect(steps.filter((s) => s.required && !s.done)).toEqual([]);
  });

  it("holds exactly the active packages that have no passing lab result", async () => {
    const mk = () => receivePackage(actor, { tag: tag(), itemId, quantity: "5", locationId: loc });
    const none = await mk(); // no lab result at all
    const pending = await mk();
    await addLabResult(actor, { packageId: pending.id, labName: "Lab", status: "PENDING", thcPercent: "" });
    const passed = await mk();
    await addLabResult(actor, { packageId: passed.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    const failed = await mk();
    await addLabResult(actor, { packageId: failed.id, labName: "Lab", status: "FAIL", thcPercent: "20" });

    const waiting = await packagesWaitingOnLab(db, actor);
    expect(waiting).toContain(none.id);
    expect(waiting).toContain(pending.id);
    expect(waiting).not.toContain(passed.id);
    expect(waiting).not.toContain(failed.id);

    const r = await setPackagesStatus(actor, { packageIds: [none.id, pending.id], status: "ON_HOLD", reason: "Held until a passing lab result is recorded" });
    expect(r.changed).toBe(2);
    const after = await packagesWaitingOnLab(db, actor);
    expect(after).not.toContain(none.id);
    expect(after).not.toContain(pending.id);
    const [row] = await db.select().from(packages).where(eq(packages.id, none.id));
    expect(row.status).toBe("ON_HOLD");
  });
});
