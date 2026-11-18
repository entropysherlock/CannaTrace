import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { facilities, organizations } from "@/db/schema";
import { change, commandCenter, describe as describeAudit, summarize, toRange } from "@/lib/dashboard";
import { db } from "@/lib/db";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("Command Center numbers", () => {
  it("compares periods as a percent, and has nothing to say without a period before", () => {
    expect(change(112, 100)).toBe(12);
    expect(change(90, 120)).toBe(-25);
    expect(change(5, 0)).toBeNull();
  });
  it("takes only 7, 30, or 90 days", () => {
    expect([toRange("7"), toRange(90), toRange("365"), toRange(undefined)]).toEqual([7, 90, 30, 30]);
  });
  it("describes audit entries in plain words", () => {
    expect(describeAudit("Package", "RECEIVE", { tag: "PKG-000123" })).toBe("Package PKG-000123 received");
    expect(describeAudit("Import", "IMPORT", { source: "Dutchie", packages: 23 })).toBe("23 packages imported from Dutchie");
    expect(describeAudit("ProductionRun", "COMPLETE", { name: "RUN-1" })).toBe("Production Run RUN-1 completed");
  });
  it("summarizes the numbers for Tally without an AI call", () => {
    const text = summarize({
      sales: { total: 4982, change: 11.2 } as never,
      packages: { total: 6428, availablePct: 72.4 } as never,
      production: { units: 2400, change: 9.7 } as never,
      alerts: { open: 3, urgent: 1 } as never,
    });
    expect(text).toBe(
      "Sales are $4,982 (up 11.2% on the period before). 72.4% of 6,428 packages are available to sell. Production made 2,400 units (up 9.7% on the period before). Tally Watch has 3 items to look at, 1 urgent.",
    );
  });
});

describe.skipIf(!hasDb)("Command Center numbers (database)", () => {
  it("adds up one facility or the whole business, over 7, 30, or 90 days", async () => {
    const [demo] = await db.select().from(organizations).where(eq(organizations.name, "Demo Cannabis Co"));
    const org = demo?.id ?? (await db.select().from(organizations).limit(1))[0].id;
    const all = await db.select().from(facilities).where(eq(facilities.orgId, org));
    const one = await commandCenter(org, [all[0].id], 30);
    const every = await commandCenter(org, all.map((f) => f.id), 30);
    expect(one.sales.points).toHaveLength(30);
    expect((await commandCenter(org, [all[0].id], 7)).sales.points).toHaveLength(7);
    expect(every.plants.total).toBeGreaterThanOrEqual(one.plants.total);
    expect(every.packages.total).toBeGreaterThanOrEqual(one.packages.total);
    expect(one.packages.parts.reduce((s, p) => s + p.value, 0)).toBe(one.packages.total);
    expect(every.facilities.length).toBe(all.length);
    expect(one.facilities.filter((f) => f.inScope).map((f) => f.id)).toEqual([all[0].id]);
  });
});
