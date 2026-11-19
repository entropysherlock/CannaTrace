import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { facilities, organizations } from "@/db/schema";
import { change, commandCenter, describe as describeAudit, summarize, toRange } from "@/lib/dashboard";
import { db } from "@/lib/db";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("Dashboard numbers", () => {
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
      days: 30,
      sales: { total: 4982, change: 11.2 } as never,
      packages: { total: 6428, availablePct: 72.4 } as never,
      production: { units: 2400, change: 9.7 } as never,
      alerts: { open: 3, urgent: 1 } as never,
    });
    expect(text).toBe(
      "Sales over the last 30 days are $4,982 (up 11.2% on the period before). 72.4% of 6,428 packages are available to sell. Production made 2,400 units (up 9.7% on the period before). Tally Watch has 3 items to look at, 1 urgent.",
    );
  });
});

/** The business with the most going on (young plants, open alerts, sales), so the cross-checks have real numbers to compare. */
async function busiest(): Promise<string> {
  const rows = await db.execute<{ org_id: string }>(sql`
    select o.id as org_id from organizations o
    order by (select coalesce(sum(untagged_count), 0) from plant_batches b where b.org_id = o.id and b.status = 'ACTIVE')
           + (select count(*) from watch_findings w where w.org_id = o.id and w.status = 'OPEN')
           + (select count(*) from sales s where s.org_id = o.id and s.status = 'COMPLETED') desc
    limit 1`);
  return rows.rows[0].org_id;
}

describe.skipIf(!hasDb)("Dashboard numbers (database)", () => {
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

  it("adds up the same everywhere: cards, the donut, the facility list, and Tally's summary", async () => {
    const org = await busiest();
    const all = await db.select().from(facilities).where(eq(facilities.orgId, org));
    for (const days of [7, 30] as const) {
      const every = await commandCenter(org, all.map((f) => f.id), days);
      const sum = (k: "plants" | "packages" | "alerts" | "sales") => every.facilities.reduce((t, f) => t + f[k], 0);
      // Packages: active (the card) plus held equals the donut's total, and its parts add up to it
      expect(every.packages.active + every.packages.held).toBe(every.packages.total);
      expect(every.packages.parts.reduce((t, p) => t + p.value, 0)).toBe(every.packages.total);
      // The facility list adds up to the business-wide cards
      expect(sum("plants")).toBe(every.plants.total);
      expect(sum("packages")).toBe(every.packages.active);
      expect(sum("alerts")).toBe(every.alerts.open);
      expect(Math.round(sum("sales") * 100)).toBe(Math.round(every.sales.total * 100));
      if (every.packages.total) expect(summarize(every)).toContain(`of ${every.packages.total.toLocaleString("en-US")} packages`);
    }
  });

  it("counts only the alerts a person may see, like the bell and the Tally Watch page", async () => {
    const org = await busiest();
    const ids = (await db.select().from(facilities).where(eq(facilities.orgId, org))).map((f) => f.id);
    const everything = await commandCenter(org, ids, 30);
    const limited = await commandCenter(org, ids, 30, (permission) => !permission);
    expect(limited.alerts.open).toBeLessThanOrEqual(everything.alerts.open);
    expect(limited.facilities.reduce((t, f) => t + f.alerts, 0)).toBe(limited.alerts.open);
  });
});
