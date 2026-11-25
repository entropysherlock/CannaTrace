import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { aiConnections, aiUsage, auditLogs, facilities, organizations, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import {
  checkConnection,
  checkLimits,
  connectKey,
  disconnect,
  explainProviderError,
  getConnection,
  markProblem,
  recordUsage,
  reserveUsage,
  settleUsage,
  RESERVATION_MS,
  resolveTally,
  setLimits,
  setModel,
  type Validator,
} from "@/lib/ai/connection";
import { encryptionReady, keyHint, needsReseal, openSecret, sealSecret } from "@/lib/ai/secret-box";
import { claudeModel, runAssistant, type Model } from "@/lib/assistant/engine";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `BYOK${Date.now().toString(36)}`;
const KEY_A = `sk-ant-api03-${"A".repeat(40)}${run}aaaa`;
const KEY_A2 = `sk-ant-api03-${"B".repeat(40)}${run}bbbb`;
const masterA = randomBytes(32).toString("base64");
const masterB = randomBytes(32).toString("hex");
const env = { ...process.env };

afterEach(() => {
  for (const k of ["AI_KEY_ENCRYPTION_KEY", "AI_KEY_ENCRYPTION_KEY_PREVIOUS", "ANTHROPIC_API_KEY", "TALLY_PLATFORM_ORGS", "ASSISTANT_FAKE", "TALLY_DEV_USE_PLATFORM_KEY"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  process.env.AI_KEY_ENCRYPTION_KEY = masterA;
  delete process.env.ASSISTANT_FAKE;
});

describe("encrypting saved keys", () => {
  beforeAll(() => {
    process.env.AI_KEY_ENCRYPTION_KEY = masterA;
  });

  it("round-trips, never stores the key in readable form, and only shows the last four characters", () => {
    const sealed = sealSecret(KEY_A, "org-1");
    expect(sealed).not.toContain(KEY_A);
    expect(sealed).not.toContain(KEY_A.slice(10, 30));
    expect(openSecret(sealed, "org-1")).toBe(KEY_A);
    expect(sealSecret(KEY_A, "org-1")).not.toBe(sealed); // fresh nonce each time
    expect(keyHint(KEY_A)).toBe("sk-ant-…aaaa");
  });

  it("refuses to open a key for a different business, or one that was tampered with", () => {
    const sealed = sealSecret(KEY_A, "org-1");
    expect(() => openSecret(sealed, "org-2")).toThrow(/could not be decrypted/);
    const parts = sealed.split(".");
    parts[4] = Buffer.from("tampered").toString("base64");
    expect(() => openSecret(parts.join("."), "org-1")).toThrow(/could not be decrypted/);
  });

  it("rotates the master key: old values still open with the previous key and are flagged for re-encryption", () => {
    const old = sealSecret(KEY_A, "org-1");
    process.env.AI_KEY_ENCRYPTION_KEY = masterB;
    process.env.AI_KEY_ENCRYPTION_KEY_PREVIOUS = masterA;
    expect(openSecret(old, "org-1")).toBe(KEY_A);
    expect(needsReseal(old)).toBe(true);
    expect(needsReseal(sealSecret(KEY_A, "org-1"))).toBe(false);
    delete process.env.AI_KEY_ENCRYPTION_KEY_PREVIOUS;
    expect(() => openSecret(old, "org-1")).toThrow(/no longer has/);
  });

  it("will not store anything without a master key", () => {
    delete process.env.AI_KEY_ENCRYPTION_KEY;
    expect(encryptionReady()).toBe(false);
    expect(() => sealSecret(KEY_A, "org-1")).toThrow(/AI_KEY_ENCRYPTION_KEY is missing/);
    process.env.AI_KEY_ENCRYPTION_KEY = "too-short";
    expect(encryptionReady()).toBe(false);
    // Any long random secret works too, not only the generated format
    process.env.AI_KEY_ENCRYPTION_KEY = "  correct-horse-battery-staple-and-more-words-1234  ";
    expect(encryptionReady()).toBe(true);
    expect(openSecret(sealSecret(KEY_A, "org-1"), "org-1")).toBe(KEY_A);
  });
});

describe("explaining Anthropic errors to a store manager", () => {
  it("names billing, bad keys, and rate limits plainly", () => {
    expect(explainProviderError({ status: 402 }).kind).toBe("NO_CREDIT");
    expect(explainProviderError({ status: 400, message: "Your credit balance is too low to access the Anthropic API." }).kind).toBe("NO_CREDIT");
    expect(explainProviderError({ status: 401 }).kind).toBe("INVALID_KEY");
    expect(explainProviderError({ status: 429 }).message).toMatch(/limiting how many requests/);
    expect(explainProviderError({ status: 529 }).message).toMatch(/busy/);
    expect(explainProviderError(new Error("fetch failed")).message).toMatch(/couldn't reach Anthropic/);
  });
});

describe.skipIf(!hasDb)("business Claude connections (database)", () => {
  let owner: Session;
  let manager: Session;
  let otherOwner: Session;
  let demoOrg: string;
  const session = (org: string, fac: string, user: string, role: Role, name: string): Session => ({
    userId: user,
    orgId: org,
    facilityId: fac,
    role,
    name,
    permissions: permissionsFor(role),
    roleName: role,
    customRoleId: null,
  });
  const goodKey: Validator = async () => [
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  ];

  beforeAll(async () => {
    process.env.AI_KEY_ENCRYPTION_KEY = masterA;
    const [a, b, demo] = await db
      .insert(organizations)
      .values([{ name: `Byok A ${run}` }, { name: `Byok B ${run}` }, { name: `Byok Demo ${run}`, isDemo: true }])
      .returning();
    demoOrg = demo.id;
    const [fa, fb] = await db
      .insert(facilities)
      .values([
        { orgId: a.id, name: "A", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" },
        { orgId: b.id, name: "B", licenseNumber: `${run}-B`, licenseType: "RETAIL", state: "NM" },
      ])
      .returning();
    const [ua, um, ub] = await db
      .insert(users)
      .values([
        { orgId: a.id, name: "Ann Owner", email: `ann-${run}@t.invalid`, passwordHash: "x", role: "OWNER" },
        { orgId: a.id, name: "Max Manager", email: `max-${run}@t.invalid`, passwordHash: "x", role: "MANAGER" },
        { orgId: b.id, name: "Bea Owner", email: `bea-${run}@t.invalid`, passwordHash: "x", role: "OWNER" },
      ])
      .returning();
    owner = session(a.id, fa.id, ua.id, "OWNER", ua.name);
    manager = session(a.id, fa.id, um.id, "MANAGER", um.name);
    otherOwner = session(b.id, fb.id, ub.id, "OWNER", ub.name);
  });
  afterAll(() => pool.end());

  it("only lets people with the Tally AI permission manage the connection", async () => {
    await expect(connectKey(manager, { apiKey: KEY_A }, goodKey)).rejects.toThrow(/Only an owner/);
    await expect(disconnect(manager)).rejects.toThrow(/Only an owner/);
    await expect(setLimits(manager, { dailyLimit: 1, monthlyLimit: 1, perPersonDailyLimit: 1, maxAnswerTokens: 512, enabled: true })).rejects.toThrow(/Only an owner/);
  });

  it("checks a key before saving it, and saves nothing when Anthropic refuses it", async () => {
    await expect(connectKey(owner, { apiKey: "not-a-key" }, goodKey)).rejects.toThrow(/doesn't look like a Claude API key/);
    await expect(connectKey(owner, { apiKey: KEY_A }, async () => Promise.reject({ status: 401 }))).rejects.toThrow(/didn't accept this API key/);
    await expect(connectKey(owner, { apiKey: KEY_A }, async () => Promise.reject({ status: 402 }))).rejects.toThrow(/out of credits/);
    expect((await getConnection(owner.orgId)).connected).toBe(false);
  });

  it("stores only an encrypted key, shows the hint, and never puts the key in the audit trail or the page data", async () => {
    const view = await connectKey(owner, { apiKey: KEY_A }, goodKey);
    expect(view).toMatchObject({ connected: true, keyHint: "sk-ant-…aaaa", model: "claude-sonnet-5-5", status: "CONNECTED" });
    expect(JSON.stringify(view)).not.toContain(KEY_A);
    const [row] = await db.select().from(aiConnections).where(eq(aiConnections.orgId, owner.orgId));
    expect(row.encryptedKey).not.toContain(KEY_A);
    const trail = await db.execute<{ t: string }>(sql`select row_to_json(a)::text as t from audit_logs a where org_id = ${owner.orgId}`);
    expect(trail.rows.length).toBeGreaterThan(0);
    expect(trail.rows.some((r) => r.t.includes(KEY_A) || r.t.includes(KEY_A.slice(13, 45)))).toBe(false);
  });

  it("replaces (rotates) the key: the new one is used straight away", async () => {
    await connectKey(owner, { apiKey: KEY_A2 }, goodKey);
    const route = await resolveTally(owner);
    expect(route).toMatchObject({ kind: "customer", apiKey: KEY_A2, model: "claude-sonnet-5-5" });
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.orgId, owner.orgId))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["KEY_CONNECTED", "KEY_REPLACED"]));
    await expect(setModel(owner, "claude-opus-9")).rejects.toThrow(/models your Claude account can use/);
    await setModel(owner, "claude-haiku-5-5");
    expect(await resolveTally(owner)).toMatchObject({ model: "claude-haiku-5-5" });
  });

  it("keeps each business on its own key, and never quietly bills Leaf2Sale for a customer", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-platform-key-for-tests-only-0000";
    expect(await resolveTally(otherOwner)).toEqual({ kind: "off", reason: "NOT_CONNECTED" });
    // A copied row from another business cannot be opened there.
    const [row] = await db.select().from(aiConnections).where(eq(aiConnections.orgId, owner.orgId));
    await db.insert(aiConnections).values({ ...row, orgId: otherOwner.orgId });
    expect(await resolveTally(otherOwner)).toEqual({ kind: "off", reason: "KEY_UNREADABLE" });
    await db.delete(aiConnections).where(eq(aiConnections.orgId, otherOwner.orgId));
    // Leaf2Sale's key only for the live demo or a business Leaf2Sale lists on purpose.
    expect(await resolveTally({ orgId: demoOrg, isDemo: true })).toMatchObject({ kind: "platform" });
    process.env.TALLY_PLATFORM_ORGS = otherOwner.orgId;
    expect(await resolveTally(otherOwner)).toMatchObject({ kind: "platform" });
  });

  it("enforces per-person, daily, and monthly limits", async () => {
    await setLimits(owner, { dailyLimit: 3, monthlyLimit: 4, perPersonDailyLimit: 2, maxAnswerTokens: 1024, enabled: true });
    await expect(setLimits(owner, { dailyLimit: 2, monthlyLimit: 4, perPersonDailyLimit: 3, maxAnswerTokens: 1024, enabled: true })).rejects.toThrow(/can't be more/);
    const route = await resolveTally(owner);
    if (route.kind === "off") throw new Error("expected a route");
    expect(route.maxTokens).toBe(1024);
    const limits = route.limits;
    await checkLimits(owner, limits);
    await recordUsage(owner, route, { inputTokens: 100, outputTokens: 20, outcome: "OK" });
    await recordUsage(owner, route, { inputTokens: 100, outputTokens: 20, outcome: "OK" });
    await expect(checkLimits(owner, limits)).rejects.toThrow(new RegExp(`limit of ${limits.perPersonDailyLimit} Tally questions? per person`));
    await checkLimits(manager, limits);
    await recordUsage(manager, route, { inputTokens: 1, outputTokens: 1, outcome: "NO_CREDIT" });
    await expect(checkLimits(manager, limits)).rejects.toThrow(/used its 3 Tally questions for the last 24 hours/);
    // Older usage from earlier this month counts toward the monthly limit only.
    const firstOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 30));
    if (Date.now() - firstOfMonth.getTime() > 26 * 3600 * 1000) {
      await db.execute(sql`update ai_usage set created_at = ${firstOfMonth} where org_id = ${owner.orgId}`);
      await recordUsage(manager, route, { inputTokens: 1, outputTokens: 1, outcome: "OK" });
      await expect(checkLimits(manager, limits)).rejects.toThrow(/for this month/);
    }
    await db.delete(aiUsage).where(eq(aiUsage.orgId, owner.orgId));
  });

  it("reserves each question before it runs, so simultaneous questions can't all slip under the limit", async () => {
    await setLimits(owner, { dailyLimit: 3, monthlyLimit: 10, perPersonDailyLimit: 3, maxAnswerTokens: 1024, enabled: true });
    const route = await resolveTally(owner);
    if (route.kind === "off") throw new Error("expected a route");
    // Ten questions at the same moment: exactly three get a slot
    const tries = await Promise.allSettled(Array.from({ length: 10 }, () => reserveUsage(owner, route)));
    const taken = tries.filter((t) => t.status === "fulfilled").map((t) => (t as PromiseFulfilledResult<string>).value);
    expect(taken).toHaveLength(3);
    expect(tries.filter((t) => t.status === "rejected").every((t) => /Tally questions? per person|used its 3/.test(String((t as PromiseRejectedResult).reason)))).toBe(true);
    expect(await db.$count(aiUsage, eq(aiUsage.orgId, owner.orgId))).toBe(3);
    await expect(checkLimits(owner, route.limits)).rejects.toThrow();

    // A cancelled request that never reached Claude releases its slot...
    await settleUsage(taken[0], { inputTokens: 0, outputTokens: 0, outcome: "ABORTED" });
    // ...and so does one that failed before spending anything
    await settleUsage(taken[1], { inputTokens: 0, outputTokens: 0, outcome: "INVALID_KEY" });
    // One cancelled after Claude answered keeps counting: it was paid for
    await settleUsage(taken[2], { inputTokens: 900, outputTokens: 40, outcome: "ABORTED" });
    const again = await Promise.allSettled(Array.from({ length: 5 }, () => reserveUsage(owner, route)));
    expect(again.filter((t) => t.status === "fulfilled")).toHaveLength(2);

    // Settling happens once: a second settle can't rewrite what was used
    await settleUsage(taken[2], { inputTokens: 0, outputTokens: 0, outcome: "ABORTED" });
    const [kept] = await db.select().from(aiUsage).where(eq(aiUsage.id, taken[2]));
    expect(kept).toMatchObject({ inputTokens: 900, outputTokens: 40, outcome: "ABORTED" });
    await db.delete(aiUsage).where(eq(aiUsage.orgId, owner.orgId));
  });

  it("stops counting a reservation that was never settled (a crashed request) after a while", async () => {
    await setLimits(owner, { dailyLimit: 1, monthlyLimit: 10, perPersonDailyLimit: 1, maxAnswerTokens: 1024, enabled: true });
    const route = await resolveTally(owner);
    if (route.kind === "off") throw new Error("expected a route");
    const now = new Date();
    await reserveUsage(owner, route, new Date(now.getTime() - RESERVATION_MS - 60_000));
    // Within the window it still holds the slot; past it, the slot is free again
    await expect(checkLimits(owner, route.limits, new Date(now.getTime() - RESERVATION_MS + 30_000))).rejects.toThrow();
    await checkLimits(owner, route.limits, now);
    await reserveUsage(owner, route, now);
    await expect(reserveUsage(owner, route, now)).rejects.toThrow();
    await db.delete(aiUsage).where(eq(aiUsage.orgId, owner.orgId));
  });

  it("records a failed billing state when Claude says the account is out of credits", async () => {
    await markProblem(owner.orgId, explainProviderError({ status: 400, message: "Your credit balance is too low" }));
    expect(await getConnection(owner.orgId)).toMatchObject({ status: "NO_CREDIT" });
    const fixed = await checkConnection(owner, goodKey);
    expect(fixed.status).toBe("CONNECTED");
    const broken = await checkConnection(owner, async () => Promise.reject({ status: 401 }));
    expect(broken).toMatchObject({ status: "INVALID_KEY" });
  });

  it("counts tokens across tool steps and keeps permissions: tools are still limited to the person's role", async () => {
    const seenTools: string[][] = [];
    const scripted: Model = async ({ tools }) => {
      seenTools.push(tools.map((t) => t.name));
      return { content: [{ type: "text", text: "ok", citations: null }] as never, stop_reason: "end_turn", usage: { input_tokens: 50, output_tokens: 7 } };
    };
    const budtender = { ...manager, role: "BUDTENDER" as const, permissions: permissionsFor("BUDTENDER") };
    const usage = await runAssistant(budtender, [{ role: "user", content: "hi" }], () => {}, new AbortController().signal, scripted);
    expect(usage).toEqual({ inputTokens: 50, outputTokens: 7 });
    expect(seenTools[0]).not.toContain("adjust_package");
    expect(typeof claudeModel("sk-ant-test", "claude-sonnet-5-5", 512)).toBe("function");
  });

  it("disconnecting removes the key and turns Tally off for that business", async () => {
    await disconnect(owner);
    expect((await getConnection(owner.orgId)).connected).toBe(false);
    expect(await resolveTally(owner)).toEqual({ kind: "off", reason: "NOT_CONNECTED" });
  });
});
