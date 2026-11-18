import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { facilities, organizations } from "@/db/schema";
import { change, commandCenter, describe as describeAudit, summarize, toRange } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { groupFindings } from "@/lib/watch/groups";

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
      days: 30,
      sales: { total: 4982, change: 11.2 } as never,
      packages: { total: 6428, available: 4654, availablePct: 72.4 } as never,
      production: { units: 2400, change: 9.7 } as never,
      alerts: { open: 3, urgent: 1 } as never,
    });
    expect(text).toBe(
      "Sales over the last 30 days are $4,982 (up 11.2% on the period before). 4,654 of 6,428 packages in stock (72.4%) are available to sell. Production made 2,400 units (up 9.7% on the period before). Tally Watch has 3 items to look at, 1 urgent.",
    );
  });
  it("groups Tally Watch alerts by root cause and severity, keeping every alert", () => {
    const alerts = [
      { id: 1, check: "state_missing", severity: "critical" },
      { id: 2, check: "unlabeled", severity: "warning" },
      { id: 3, check: "state_missing", severity: "critical" },
      { id: 4, check: "license", severity: "warning" },
      { id: 5, check: "license", severity: "critical" },
      { id: 6, check: "run_open", severity: "info" },
      { id: 7, check: "something_new", severity: "warning" },
    ];
    const groups = groupFindings(alerts);
    // Urgent first, then the biggest groups
    expect(groups.map((g) => [g.check, g.severity, g.count])).toEqual([
      ["state_missing", "critical", 2],
      ["license", "critical", 1],
      // same size: alphabetical by cause ("New packages…", "Orders shipping…", "Other things…")
      ["unlabeled", "warning", 1],
      ["license", "warning", 1],
      ["something_new", "warning", 1],
      ["run_open", "info", 1],
    ]);
    // No alert is lost or repeated, and each keeps its place inside its group
    expect(groups.flatMap((g) => g.items.map((a) => a.id)).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(groups[0].items.map((a) => a.id)).toEqual([1, 3]);
    expect(groups.find((g) => g.check === "something_new")?.label).toBe("Other things to look at");
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
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

  it("uses one definition for each number on every card, the facility list and Tally's summary", async () => {
    const org = (await db.select().from(organizations).limit(1))[0].id;
    const all = await db.select().from(facilities).where(eq(facilities.orgId, org));
    for (const days of [7, 30] as const) {
      const every = await commandCenter(org, all.map((f) => f.id), days);
      const sum = (k: "plants" | "packages" | "alerts" | "sales") => every.facilities.reduce((s, f) => s + f[k], 0);
      // The KPI, the inventory-health donut and Tally all count the same packages
      expect(every.packages.parts.reduce((s, p) => s + p.value, 0)).toBe(every.packages.total);
      expect(every.packages.available + every.packages.reserved + every.packages.held).toBe(every.packages.total);
      const text = summarize(every);
      if (every.packages.total) expect(text).toContain(`of ${every.packages.total.toLocaleString("en-US")} packages in stock`);
      // The facility list adds up to the business-wide totals
      expect(sum("plants")).toBe(every.plants.total);
      expect(sum("packages")).toBe(every.packages.total);
      expect(sum("alerts")).toBe(every.alerts.open);
      expect(Math.round(sum("sales") * 100)).toBe(Math.round(every.sales.total * 100));
      // The Tally Watch groups add up to the alert count when there are four kinds or fewer
      const grouped = every.alerts.groups.reduce((s, g) => s + g.count, 0);
      expect(grouped).toBeLessThanOrEqual(every.alerts.open);
      if (every.alerts.groups.length < 4) expect(grouped).toBe(every.alerts.open);
    }
  });

  it("counts only the alerts a person may see", async () => {
    const org = (await db.select().from(organizations).limit(1))[0].id;
    const all = await db.select().from(facilities).where(eq(facilities.orgId, org));
    const ids = all.map((f) => f.id);
    const owner = await commandCenter(org, ids, 30);
    const none = await commandCenter(org, ids, 30, (permission) => !permission);
    expect(none.alerts.open).toBeLessThanOrEqual(owner.alerts.open);
    expect(none.facilities.reduce((s, f) => s + f.alerts, 0)).toBe(none.alerts.open);
  });
});
