import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { organizations, packages, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { DEMO_ASSISTANT_DAILY_LIMIT, demoDayKey, liveDemoSession, takeDemoAssistantCall } from "@/lib/demo/live-demo";
import { needsSetup } from "@/lib/setup";

const hasDb = Boolean(process.env.DATABASE_URL);
// Days far in the future, so they never clash with the real "today" used by the browser tests.
const offset = Math.floor(Math.random() * 300);
const day1 = new Date(Date.UTC(2090 + Math.floor(offset / 12), offset % 12, 3));
const day2 = new Date(day1.getTime() + 24 * 60 * 60 * 1000);

afterAll(() => pool.end());

describe.skipIf(!hasDb)("live demo", () => {
  it("gives every visitor on the same day the same filled sample business", { timeout: 120_000 }, async () => {
    const before = await needsSetup();
    const [a, b] = await Promise.all([liveDemoSession(day1), liveDemoSession(day1)]);
    expect(a.orgId).toBe(b.orgId);
    expect(a.role).toBe("OWNER");
    const [org] = await db.select().from(organizations).where(eq(organizations.id, a.orgId));
    expect(org.isDemo).toBe(true);
    expect(org.demoReady).toBe(true);
    expect(org.demoDay).toBe(demoDayKey(day1));
    expect(await db.$count(packages, eq(packages.orgId, a.orgId))).toBeGreaterThan(5);
    // The demo's sample team never counts as a real business.
    expect(await needsSetup()).toBe(before);
  });

  it("starts fresh the next day and switches off the old day's sign-ins", { timeout: 120_000 }, async () => {
    const old = await liveDemoSession(day1);
    const fresh = await liveDemoSession(day2);
    expect(fresh.orgId).not.toBe(old.orgId);
    expect(await db.$count(users, and(eq(users.orgId, old.orgId), eq(users.active, true)))).toBe(0);
    expect(await db.$count(users, and(eq(users.orgId, fresh.orgId), eq(users.active, true)))).toBeGreaterThan(0);
  });

  it("caps Tally questions per demo day and never limits real businesses through this counter", async () => {
    const { orgId } = await liveDemoSession(day2);
    await db.update(organizations).set({ demoAssistantCalls: DEMO_ASSISTANT_DAILY_LIMIT - 1 }).where(eq(organizations.id, orgId));
    expect(await takeDemoAssistantCall(orgId)).toBe(true);
    expect(await takeDemoAssistantCall(orgId)).toBe(false);
    const [real] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isDemo, false)).limit(1);
    if (real) expect(await takeDemoAssistantCall(real.id)).toBe(false);
  });
});
