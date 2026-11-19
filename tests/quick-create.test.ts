import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, itemCategories, organizations, users } from "@/db/schema";
import { sameName } from "@/lib/contextual-create";
import { db, pool } from "@/lib/db";
import { createDriver, createVehicle } from "@/lib/distribution";
import { createLocation, findLocationByName } from "@/lib/facilities";
import type { Actor } from "@/lib/inventory";
import { createCategory, findCategoryByName, findItemByName, quickAddItem } from "@/lib/quick-item";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `Q${Date.now().toString(36).toUpperCase()}`;
let actor: Actor;

describe("sameName", () => {
  it("ignores letter case and extra spaces", () => {
    expect(sameName("  Blue   Dream ", "blue dream")).toBe(true);
    expect(sameName("Blue Dream", "Blue Dreams")).toBe(false);
  });
});

describe.skipIf(!hasDb)("create without leaving: the shared library pieces (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Quick Org ${run}` }).returning();
    const [facility] = await db
      .insert(facilities)
      .values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Manager", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" })
      .returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
  });

  afterAll(async () => {
    await pool.end();
  });

  it("makes a location once, logs it, and finds it again by a differently typed name", async () => {
    const made = await createLocation(actor, { name: " Vault  B ", type: "RACK" });
    expect(made.name).toBe("Vault B");
    expect(await findLocationByName(actor.orgId, actor.facilityId, "vault b")).toMatchObject({ id: made.id });
    await expect(createLocation(actor, { name: "Vault B", type: "RACK" })).rejects.toThrow("already has a location called Vault B");
    await expect(createLocation(actor, { name: "Shelf", type: "DRAWER" })).rejects.toThrow("Choose a location type.");
    const logged = await db.select().from(auditLogs).where(eq(auditLogs.entityId, made.id));
    expect(logged.map((l) => l.action)).toEqual(["CREATE"]);
  });

  it("treats categories that differ only in case or spacing as one, everywhere", async () => {
    const edibles = await createCategory(actor, "Edibles");
    await expect(createCategory(actor, "  edibles ")).rejects.toThrow("There is already a category called Edibles.");
    expect(await findCategoryByName(actor.orgId, "EDIBLES")).toMatchObject({ id: edibles.id });
    // A quick item typed into "edibles" joins the existing category instead of making a twin.
    const gummy = await quickAddItem(actor, { name: "Gummy  Pack", unit: "EACH", category: "edibles" });
    const cats = await db.select().from(itemCategories).where(eq(itemCategories.orgId, actor.orgId));
    expect(cats.map((c) => c.name)).toEqual(["Edibles"]);
    expect(gummy.name).toBe("Gummy Pack");
    expect(await findItemByName(actor.orgId, "gummy pack")).toMatchObject({ id: gummy.id, unit: "EACH" });
    await expect(quickAddItem(actor, { name: "GUMMY PACK", unit: "EACH", category: "Edibles" })).rejects.toThrow("already have an item called");
  });

  it("returns the new driver's and vehicle's ids so a picker can select them", async () => {
    const driver = await createDriver(actor, { name: "Dana", licenseNumber: `DL-${run}` });
    const van = await createVehicle(actor, { make: "Ford", model: "Transit", plate: `p${run}`.slice(0, 10) });
    expect(driver.id).toBeTruthy();
    expect(van.id).toBeTruthy();
    await expect(createVehicle(actor, { make: "Ford", model: "Transit", plate: `p${run}`.slice(0, 10) })).rejects.toThrow("already exists");
  });
});
