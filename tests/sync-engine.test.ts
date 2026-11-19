import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { facilities, itemCategories, items, locations, organizations, syncEvents, users, type SyncEvent } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { adjustPackage, receivePackage, setPackageStatus, type Actor } from "@/lib/inventory";
import { ADAPTERS, metrcRequest, processQueue, resolveEvent, retryEvent, setFacilitySystem, type Adapter } from "@/lib/sync";
import type { SendResult } from "@/lib/sync-math";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `Y${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

let actor: Actor;
let item: string;
let shelf: string;

const events = async () =>
  db.select().from(syncEvents).where(eq(syncEvents.facilityId, actor.facilityId)).orderBy(syncEvents.seq);

/** A fake state system that answers from a script, so failures can be tested without a real one. */
function scripted(answers: SendResult[]): Adapter & { seen: SyncEvent[] } {
  const seen: SyncEvent[] = [];
  return {
    supported: ["*"],
    seen,
    status: () => ({ ready: true, note: "test" }),
    async send(event) {
      seen.push(event);
      return answers.shift() ?? { outcome: "SENT" };
    },
  };
}

describe.skipIf(!hasDb)("compliance sync (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Sync Org ${run}` }).returning();
    const [facility] = await db
      .insert(facilities)
      .values({ orgId: org.id, name: "Sync", licenseNumber: `${run}-LIC`, licenseType: "CULTIVATION", state: "NM", trackTraceSystem: "METRC" })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Syncer", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" })
      .returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Shelf", type: "RACK" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const [made] = await db.insert(items).values({ orgId: org.id, name: "Flower", sku: "F", categoryId: category.id, unit: "G" }).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    item = made.id;
    shelf = location.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("queues a record in the same transaction as the change, and only for changes the state cares about", async () => {
    const pkg = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "100", locationId: shelf });
    await setPackageStatus(actor, { packageId: pkg.id, status: "ON_HOLD", reason: "internal hold" }); // not reported
    await setPackageStatus(actor, { packageId: pkg.id, status: "ACTIVE", reason: "released" });
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "98.5", reasonCode: "DRYING", note: "after cure" });
    // A change that fails rolls back its sync record too
    await expect(adjustPackage(actor, { packageId: pkg.id, newQuantity: "-5", reasonCode: "DRYING" })).rejects.toThrow();

    const queued = await events();
    expect(queued.map((e) => e.type)).toEqual(["PACKAGE_RECEIVED", "PACKAGE_ADJUSTED"]);
    expect(queued.every((e) => e.status === "PENDING" && e.system === "METRC")).toBe(true);
    expect(queued[1].summary).toBe(`Adjusted package ${pkg.tag} from 100 to 98.5 g`);
  });

  it("builds the Metrc adjustment request from the change", async () => {
    const [adjust] = (await events()).filter((e) => e.type === "PACKAGE_ADJUSTED");
    const request = metrcRequest(adjust)!;
    expect(request.path).toBe("/packages/v2/adjust");
    expect(request.body).toEqual([
      expect.objectContaining({ Quantity: -1.5, UnitOfMeasure: "Grams", AdjustmentReason: "Moisture loss / drying", ReasonNote: "after cure" }),
    ]);
    expect(metrcRequest({ ...adjust, type: "PACKAGE_RECEIVED" })).toBeNull();
  });

  it("explains that Metrc is not connected when its keys are missing, and sends nothing else past it", async () => {
    vi.stubEnv("METRC_API_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await processQueue({ facilityId: actor.facilityId });
    // The receipt is not a type Metrc sending supports, so it is set aside for hand entry; the adjustment needs keys.
    expect(result).toMatchObject({ manual: 0, failed: 1 });
    const [first] = await events();
    expect(first).toMatchObject({ status: "FAILED", lastErrorCode: "NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends to Metrc with both keys, and turns its answers into plain error kinds", async () => {
    vi.stubEnv("METRC_API_URL", "https://api-xx.metrc.com/");
    vi.stubEnv("METRC_VENDOR_KEY", "vendor");
    vi.stubEnv("METRC_USER_KEY", "user");
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [new Response("bad key", { status: 401 }), new Response("", { status: 200 })];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), answers.shift()!)));

    const [adjust] = (await events()).filter((e) => e.type === "PACKAGE_ADJUSTED");
    const refused = await ADAPTERS.METRC.send(adjust, { licenseNumber: "LIC 1" });
    expect(refused).toMatchObject({ outcome: "ERROR", code: "AUTH_FAILED", retryable: false, detail: "Metrc answered 401: bad key" });
    expect(calls[0].url).toBe("https://api-xx.metrc.com/packages/v2/adjust?licenseNumber=LIC%201");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("vendor:user").toString("base64")}`);
    expect(await ADAPTERS.METRC.send(adjust, { licenseNumber: "LIC 1" })).toEqual({ outcome: "SENT" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    expect(await ADAPTERS.METRC.send(adjust, { licenseNumber: "x" })).toMatchObject({ code: "NETWORK", retryable: true });
  });

  it("sends in order, retries what can recover, and holds back later records behind a failure", async () => {
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    const a = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "10", locationId: shelf });
    await adjustPackage(actor, { packageId: a.id, newQuantity: "9", reasonCode: "DAMAGE" });
    await adjustPackage(actor, { packageId: a.id, newQuantity: "8", reasonCode: "DAMAGE" });

    const base = Date.now() + 60_000;
    const at = (seconds: number) => new Date(base + seconds * 1000);
    const now = at(0);
    const flaky = scripted([
      { outcome: "SENT" },
      { outcome: "ERROR", code: "SERVER_ERROR", retryable: true, detail: "503" },
    ]);
    expect(await processQueue({ facilityId: actor.facilityId, now, adapters: { METRC: flaky } })).toMatchObject({ sent: 1, retrying: 1 });
    let queue = (await events()).filter((e) => e.status !== "RESOLVED");
    expect(queue.map((e) => e.status)).toEqual(["SENT", "PENDING", "PENDING"]);
    expect(queue[1].nextAttemptAt.getTime()).toBe(at(60).getTime());

    // Too early: nothing is sent, and the record behind it waits its turn.
    expect(await processQueue({ facilityId: actor.facilityId, now: at(30), adapters: { METRC: flaky } })).toMatchObject({ sent: 0 });
    expect(flaky.seen).toHaveLength(2);

    // A permanent rejection stops the line.
    const strict = scripted([{ outcome: "ERROR", code: "REJECTED", retryable: false, detail: "Quantity does not match" }]);
    expect(await processQueue({ facilityId: actor.facilityId, now: at(120), adapters: { METRC: strict } })).toMatchObject({ failed: 1 });
    expect(await processQueue({ facilityId: actor.facilityId, now: at(180), adapters: { METRC: strict } })).toMatchObject({ blocked: 1, sent: 0 });
    queue = (await events()).filter((e) => e.status !== "RESOLVED");
    expect(queue.map((e) => e.status)).toEqual(["SENT", "FAILED", "PENDING"]);
    expect(queue[1]).toMatchObject({ attempts: 2, lastErrorCode: "REJECTED", lastErrorDetail: "Quantity does not match" });

    // Retry after fixing: both go through, in order.
    await retryEvent(actor, { eventId: queue[1].id });
    const fixed = scripted([]);
    expect(await processQueue({ facilityId: actor.facilityId, now: at(240), adapters: { METRC: fixed } })).toMatchObject({ sent: 2 });
    expect(fixed.seen.map((e) => e.seq)).toEqual([queue[1].seq, queue[2].seq]);
  });

  it("gives up after the last automatic retry", async () => {
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    await receivePackage(actor, { tag: tag(), itemId: item, quantity: "1", locationId: shelf });
    const down = scripted(Array.from({ length: 10 }, () => ({ outcome: "ERROR" as const, code: "SERVER_ERROR" as const, retryable: true, detail: "down" })));
    let at = Date.now() + 60_000;
    for (let i = 0; i < 8; i++) {
      await processQueue({ facilityId: actor.facilityId, now: new Date(at), adapters: { METRC: down } });
      at += 13 * 60 * 60_000;
    }
    const [last] = (await events()).filter((e) => e.status !== "RESOLVED");
    expect(last).toMatchObject({ status: "FAILED", attempts: 6, lastErrorCode: "SERVER_ERROR" });
  });

  it("sets aside records for hand entry without blocking, and records who handled them", async () => {
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    await setFacilitySystem(actor, { system: "NMS2S" });
    const pkg = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "5", locationId: shelf });
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "4", reasonCode: "SAMPLE" });
    expect(await processQueue({ facilityId: actor.facilityId })).toMatchObject({ manual: 2, failed: 0 });
    const [first, second] = (await events()).filter((e) => e.status !== "RESOLVED");
    expect(first).toMatchObject({ status: "MANUAL", system: "NMS2S" });
    expect(first.lastErrorDetail).toMatch(/asked New Mexico.s Cannabis Control Division for NMS2S integrator access/);

    await expect(resolveEvent(actor, { eventId: first.id, note: " " })).rejects.toThrow(/Say what was done/);
    await resolveEvent(actor, { eventId: first.id, note: "Entered in NMS2S by hand" });
    const [done] = await db.select().from(syncEvents).where(eq(syncEvents.id, first.id));
    expect(done).toMatchObject({ status: "RESOLVED", resolvedBy: "Syncer", resolvedNote: "Entered in NMS2S by hand" });

    // Switching to practice mode and retrying sends it there instead.
    await setFacilitySystem(actor, { system: "MOCK" });
    await retryEvent(actor, { eventId: second.id });
    expect(await processQueue({ facilityId: actor.facilityId })).toMatchObject({ sent: 1 });
    const [sent] = await db.select().from(syncEvents).where(eq(syncEvents.id, second.id));
    expect(sent).toMatchObject({ status: "SENT", system: "MOCK" });
    expect(sent.externalId).toMatch(/^PRACTICE-\d+$/);
  });

  it("never lets two workers send the same facility's records at once", async () => {
    await receivePackage(actor, { tag: tag(), itemId: item, quantity: "1", locationId: shelf });
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: Adapter = {
      supported: ["*"],
      status: () => ({ ready: true, note: "" }),
      async send() {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 150));
        inFlight -= 1;
        return { outcome: "SENT" };
      },
    };
    const [one, two] = await Promise.all([
      processQueue({ facilityId: actor.facilityId, adapters: { MOCK: slow } }),
      processQueue({ facilityId: actor.facilityId, adapters: { MOCK: slow } }),
    ]);
    expect(one.sent + two.sent).toBe(1);
    expect(maxInFlight).toBe(1);
    const sentTwice = await db.execute(sql`select 1 from sync_events where facility_id = ${actor.facilityId} and attempts > 1 and status = 'SENT' and type = 'PACKAGE_RECEIVED' and created_at > now() - interval '1 minute'`);
    expect(sentTwice.rows).toHaveLength(0);
  });

  it("keeps what the state already accepted when a run stops part way, and frees the facility for the next run", async () => {
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    const a = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "10", locationId: shelf });
    await adjustPackage(actor, { packageId: a.id, newQuantity: "9", reasonCode: "DAMAGE" });
    let calls = 0;
    // The first record reaches the state; then the run dies (a crash or the server's time limit)
    const crashing: Adapter = {
      supported: ["*"],
      status: () => ({ ready: true, note: "" }),
      async send() {
        calls += 1;
        if (calls === 2) throw new Error("function timed out");
        return { outcome: "SENT" };
      },
    };
    await expect(processQueue({ facilityId: actor.facilityId, adapters: { METRC: crashing, MOCK: crashing } })).rejects.toThrow(/timed out/);
    const queue = (await events()).filter((e) => e.status !== "RESOLVED");
    // Before: one transaction for the whole run, so the crash rolled the first record back to PENDING and it was sent again
    expect(queue.map((e) => e.status)).toEqual(["SENT", "PENDING"]);
    const ok: Adapter = { supported: ["*"], status: () => ({ ready: true, note: "" }), send: async () => ({ outcome: "SENT" }) };
    expect(await processQueue({ facilityId: actor.facilityId, adapters: { METRC: ok, MOCK: ok } })).toMatchObject({ sent: 1 });
  });

  it("stops starting new sends at its time budget and leaves the rest for the next run", async () => {
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    await receivePackage(actor, { tag: tag(), itemId: item, quantity: "3", locationId: shelf });
    const result = await processQueue({ facilityId: actor.facilityId, budgetMs: -1 });
    expect(result).toMatchObject({ sent: 0, deferred: 1 });
    expect((await events()).filter((e) => e.status === "PENDING")).toHaveLength(1);
  });
});
