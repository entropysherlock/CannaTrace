import { and, eq, inArray } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import { facilities, harvests, items, labResults, locations, orders, packages, plants, sales } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { loadSampleFacility, SAMPLE_LICENSE } from "@/lib/demo/sample-facility";
import { loadLabelRecords } from "@/lib/labels/data";
import { createBusiness } from "@/lib/setup";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = Date.now().toString(36);

describe.skipIf(!hasDb)("sample facility", () => {
  afterAll(() => pool.end());

  it("adds a complete, separate facility to an existing business, once", async () => {
    const owner = await createBusiness(
      { businessName: `Sample Test ${run}`, facilityName: "Real Store", licenseNumber: `REAL-${run}`, licenseType: "RETAIL", state: "NM", ownerName: "Owner", email: `owner-${run}@sample.test`, password: "a-long-test-password" },
      { onlyIfEmpty: false },
    );
    const who = { orgId: owner.orgId, userId: owner.userId, userName: owner.name };
    const started = Date.now();
    const { facilityId, summary } = await loadSampleFacility(who);
    console.log(`sample facility loaded in ${Date.now() - started} ms: ${summary}`);

    const [f] = await db.select().from(facilities).where(eq(facilities.id, facilityId));
    expect(f).toMatchObject({ licenseNumber: SAMPLE_LICENSE, licenseType: "MICROBUSINESS", state: "NM" });
    const here = (col: AnyPgColumn) => eq(col, facilityId);
    expect(await db.$count(locations, here(locations.facilityId))).toBe(14);
    expect(await db.$count(plants, and(here(plants.facilityId), eq(plants.status, "ACTIVE")))).toBeGreaterThanOrEqual(80);
    expect(await db.$count(harvests, here(harvests.facilityId))).toBe(2);
    expect(await db.$count(packages, here(packages.facilityId))).toBeGreaterThanOrEqual(20);
    expect(await db.$count(orders, here(orders.facilityId))).toBe(2);
    expect(await db.$count(sales, and(here(sales.facilityId), eq(sales.status, "COMPLETED")))).toBe(3);
    // The failed package quarantined itself
    const [failed] = await db.select().from(packages).where(and(here(packages.facilityId), eq(packages.tag, "SMP-000012")));
    expect(failed.status).toBe("QUARANTINE");
    // The owner's real facility is untouched
    expect(await db.$count(packages, eq(packages.facilityId, owner.facilityId))).toBe(0);

    // Jars from the finished harvest print a full New Mexico label
    const [jar] = await db.select().from(packages).where(and(here(packages.facilityId), eq(packages.tag, "SMP-000030")));
    const [label] = await loadLabelRecords({ orgId: owner.orgId, facilityId }, "PRODUCT", [jar.id]);
    expect(label.values).toMatchObject({ "package.harvest": "SS-H-1104", "package.netQuantity": "3.5 g (0.12 oz)", "item.strainType": "Indica", "lab.thc": "26.3%" });
    expect(label.values["lab.profile"]).toContain("THCa");
    expect(await db.$count(labResults, inArray(labResults.packageId, [jar.id]))).toBe(1);
    expect(await db.$count(items, eq(items.orgId, owner.orgId))).toBe(13);

    await expect(loadSampleFacility(who)).rejects.toThrow(/already loaded/);
  }, 120_000);
});
