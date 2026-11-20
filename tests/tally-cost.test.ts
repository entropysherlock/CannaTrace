import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiUsage, organizations } from "@/db/schema";
import { costUsd, formatUsd, priceFor } from "@/lib/ai/pricing";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("what Tally costs in dollars", () => {
  it("prices each model at Anthropic's list price, including dated model ids", () => {
    expect(priceFor("claude-sonnet-5-5")).toEqual({ input: 2, output: 10 });
    expect(priceFor("claude-opus-5-5")).toEqual({ input: 4, output: 20 });
    expect(priceFor("claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5 });
    // The longest matching name wins: Opus 4.5 is not priced as Opus 4.
    expect(priceFor("claude-opus-4-5-20251101")).toEqual({ input: 5, output: 25 });
    expect(priceFor("claude-opus-4-20250514")).toEqual({ input: 15, output: 75 });
    expect(priceFor("claude-sonnet-4-5-20250929")).toEqual({ input: 3, output: 15 });
    expect(priceFor("gpt-4")).toBeNull();
    expect(priceFor("claude-sonnet-5-50")).toEqual({ input: 2, output: 10 }); // "claude-sonnet-5" then "-50"
  });

  it("turns tokens into dollars", () => {
    // 1M input at $2 plus 100k output at $10 = $3
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 100_000)).toBeCloseTo(3);
    expect(costUsd("claude-haiku-5-5", 20_000, 1_000)).toBeCloseTo(0.0025);
    expect(costUsd("mystery-model", 10, 10)).toBeNull();
    expect(formatUsd(3)).toBe("$3.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.001)).toBe("less than $0.01");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe.skipIf(!hasDb)("Tally cost on the settings page (database)", () => {
  let org: string;
  // Imported here so the database isn't touched when there is none.
  let db: typeof import("@/lib/db").db;
  let pool: typeof import("@/lib/db").pool;
  let usageSummary: typeof import("@/lib/ai/connection").usageSummary;
  const now = new Date("2026-11-19T18:00:00Z");

  beforeAll(async () => {
    ({ db, pool } = await import("@/lib/db"));
    ({ usageSummary } = await import("@/lib/ai/connection"));
    const [o] = await db.insert(organizations).values({ name: `Cost ${Date.now()}` }).returning();
    org = o.id;
    const row = (userName: string, model: string, input: number, output: number, at: string, extra: Partial<typeof aiUsage.$inferInsert> = {}) => ({
      orgId: org,
      userId: userName,
      userName,
      billedTo: "CUSTOMER",
      model,
      inputTokens: input,
      outputTokens: output,
      outcome: "OK",
      createdAt: new Date(at),
      ...extra,
    });
    await db.insert(aiUsage).values([
      row("Ana", "claude-sonnet-5-5", 1_000_000, 100_000, "2026-11-10T12:00:00Z"), // $3.00
      row("Ana", "claude-opus-5-5", 100_000, 10_000, "2026-11-11T12:00:00Z"), // $0.60
      row("Ben", "claude-haiku-5-5", 1_000_000, 0, "2026-11-12T12:00:00Z"), // $0.10
      row("Ben", "claude-sonnet-5-5", 500_000, 0, "2026-11-12T13:00:00Z", { outcome: "ERROR" }), // $1.00, tokens were still used
      row("Ben", "some-future-model", 999, 999, "2026-11-13T12:00:00Z"),
      row("Demo", "claude-sonnet-5-5", 9_000_000, 0, "2026-11-14T12:00:00Z", { billedTo: "PLATFORM" }), // not theirs
      row("Ana", "claude-sonnet-5-5", 250_000, 0, "2026-10-20T12:00:00Z"), // last month: $0.50
      row("Ana", "claude-sonnet-5-5", 9_000_000, 0, "2026-09-20T12:00:00Z"), // too old
    ]);
  });
  afterAll(() => pool.end());

  it("adds up this month and last month per model, per person, and per answered question", async () => {
    const u = await usageSummary(org, now);
    expect(u.cost.thisMonth).toBeCloseTo(4.7);
    expect(u.cost.lastMonth).toBeCloseTo(0.5);
    // $4.70 over the 3 answered questions (the failed one still used tokens, so it counts toward cost but not answers)
    expect(u.cost.perQuestion).toBeCloseTo(4.7 / 3);
    expect(u.cost.unpricedModels).toEqual(["some-future-model"]);
    const by = Object.fromEntries(u.people.map((p) => [p.name, p.cost]));
    expect(by.Ana).toBeCloseTo(3.6);
    expect(by.Ben).toBeCloseTo(1.1);
    expect(by.Demo ?? 0).toBe(0);
  });
});
