import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, itemCategories, items, locations, nms2sCredentials, nms2sIdMap, nms2sReconciliations, nms2sRequests, organizations, syncEvents, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { adjustPackage, receivePackage, splitPackage, type Actor } from "@/lib/inventory";
import { readConfig } from "@/lib/nms2s/config";
import { credentialStatus, loadCredentials, removeCredentials, saveCredentials } from "@/lib/nms2s/credentials";
import { confirmLink, expireLeases, idempotencyKey, lookupOutcome, resolveByPerson, submitWrite } from "@/lib/nms2s/ledger";
import { runReconciliation } from "@/lib/nms2s/reconciliation";
import { Nms2sSimulator } from "@/lib/nms2s/simulator";
import { nms2sAdapter, toWriteOperation } from "@/lib/nms2s/sync-bridge";
import type { PackageAdjust } from "@/lib/nms2s/types";
import { processQueue } from "@/lib/sync";

/*
 * Integration and end-to-end tests for the NMS2S preparation layer, run against a real Postgres and
 * CannaTrace's UNOFFICIAL simulator. Results here are simulated evidence only; they are not UAT results.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `N${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;
const SECRET = "uat-secret-value-that-must-never-leak-1234";
const OTHER_SECRET = "second-facility-secret-value-5678";
const config = readConfig({});
const statusMap = { Active: "OPEN", Finished: "CLOSED" } as const;

let actor: Actor; // facility A
let other: Actor; // facility B, same business
let item: string;
let shelf: string;
let licenseA: string;
let licenseB: string;

function simulator(options?: ConstructorParameters<typeof Nms2sSimulator>[0]) {
  const s = new Nms2sSimulator(options);
  s.addAccount(SECRET, [licenseA]);
  s.addAccount(OTHER_SECRET, [licenseB]);
  return s;
}

const adjustOp = (t: string, change: string, now: string): PackageAdjust => ({ kind: "PACKAGE_ADJUST", packageTag: t, quantityChange: change, newQuantity: now, unit: "G", reason: "Count correction", note: null, occurredAt: "2026-11-19T12:00:00.000Z" });
const deps = (transport: Nms2sSimulator) => ({ transport, environment: "UAT" as const, config });

describe.skipIf(!hasDb)("NMS2S preparation (database, unofficial simulator)", () => {
  beforeAll(async () => {
    process.env.AI_KEY_ENCRYPTION_KEY ||= "1".repeat(64);
    const [org] = await db.insert(organizations).values({ name: `NMS2S Org ${run}` }).returning();
    licenseA = `${run}-CULT`;
    licenseB = `${run}-RET`;
    const [fa] = await db.insert(facilities).values({ orgId: org.id, name: "A", licenseNumber: licenseA, licenseType: "CULTIVATION", state: "NM", trackTraceSystem: "NMS2S" }).returning();
    const [fb] = await db.insert(facilities).values({ orgId: org.id, name: "B", licenseNumber: licenseB, licenseType: "RETAIL", state: "NM", trackTraceSystem: "NMS2S" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Compliance Lead", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "MANAGER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: fa.id, name: "Vault", type: "RACK" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const [made] = await db.insert(items).values({ orgId: org.id, name: "Flower", sku: "F", categoryId: category.id, unit: "G" }).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: fa.id };
    other = { ...actor, facilityId: fb.id };
    item = made.id;
    shelf = location.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // ---- credentials ---------------------------------------------------------------------------

  it("stores credentials sealed per facility and environment, and never writes the value anywhere readable", async () => {
    await saveCredentials(actor, { environment: "UAT", values: { apiKey: SECRET } }, config);
    await saveCredentials(other, { environment: "UAT", values: { apiKey: OTHER_SECRET } }, config);
    expect(await loadCredentials(actor, "UAT")).toEqual({ apiKey: SECRET });
    expect(await loadCredentials(other, "UAT")).toEqual({ apiKey: OTHER_SECRET });
    await expect(loadCredentials(actor, "PRODUCTION")).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });
    expect(await credentialStatus(actor, "UAT")).toMatchObject({ fieldHints: { apiKey: "…1234" }, savedByName: "Compliance Lead" });

    const [row] = await db.select().from(nms2sCredentials).where(eq(nms2sCredentials.facilityId, actor.facilityId));
    expect(row.sealed).not.toContain(SECRET);
    // A sealed value copied to another facility's row can't be opened there.
    await db.update(nms2sCredentials).set({ sealed: row.sealed }).where(eq(nms2sCredentials.facilityId, other.facilityId));
    await expect(loadCredentials(other, "UAT")).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });
    await saveCredentials(other, { environment: "UAT", values: { apiKey: OTHER_SECRET } }, config);

    await expect(saveCredentials(actor, { environment: "PRODUCTION", values: { apiKey: "p" } }, config)).rejects.toThrow(/approved/);
    await expect(saveCredentials(actor, { environment: "UAT", values: { "bad name": "x" } }, config)).rejects.toThrow(/valid credential name/);
    await expect(saveCredentials(actor, { environment: "UAT", values: {} }, config)).rejects.toThrow();
  });

  it("can rotate and remove credentials, with an audit trail that holds no secret", async () => {
    await saveCredentials(actor, { environment: "UAT", values: { apiKey: "temporary-rotation-value-9999" } }, config);
    await saveCredentials(actor, { environment: "UAT", values: { apiKey: SECRET } }, config);
    const a = await db.select().from(auditLogs).where(and(eq(auditLogs.orgId, actor.orgId), eq(auditLogs.entityType, "Nms2sCredential")));
    expect(a.map((r) => r.action)).toEqual(expect.arrayContaining(["SAVE", "ROTATE"]));
    expect(JSON.stringify(a)).not.toContain(SECRET);
    expect(JSON.stringify(a)).not.toContain("temporary-rotation-value-9999");
    await removeCredentials(other, "PRODUCTION"); // nothing there: no error, no entry
    expect(await credentialStatus(other, "UAT")).not.toBeNull();
  });

  // ---- ledger --------------------------------------------------------------------------------

  it("sends a write once, and replays of the same request key never send again", async () => {
    const s = simulator();
    const t = tag();
    s.seedPackage(licenseA, { tag: t, quantity: "10", unit: "G", status: "Active" });
    const key = idempotencyKey(actor.facilityId, "UAT", `test:${t}`);
    const first = await submitWrite(actor, deps(s), { op: adjustOp(t, "-1", "9"), idempotencyKey: key, local: { entityType: "Package", entityId: "x" } });
    expect(first).toMatchObject({ status: "ACCEPTED", sent: true });
    const again = await submitWrite(actor, deps(s), { op: adjustOp(t, "-1", "9"), idempotencyKey: key, local: { entityType: "Package", entityId: "x" } });
    expect(again).toMatchObject({ status: "ACCEPTED", sent: false, requestId: first.requestId });
    expect(s.writesApplied).toHaveLength(1);
    expect(s.package(licenseA, t)?.quantity).toBe("9");
    // The same key with a different body is refused before anything is sent.
    await expect(submitWrite(actor, deps(s), { op: adjustOp(t, "-5", "5"), idempotencyKey: key, local: { entityType: "Package", entityId: "x" } })).rejects.toThrow(/different write/);
    expect(s.calls.filter((c) => c.method === "submit")).toHaveLength(1);
  });

  it("lets only one of many concurrent workers send the same write", async () => {
    const s = simulator({ latencyMs: 25 });
    const t = tag();
    s.seedPackage(licenseA, { tag: t, quantity: "10", unit: "G", status: "Active" });
    const key = idempotencyKey(actor.facilityId, "UAT", `concurrent:${t}`);
    const results = await Promise.all(Array.from({ length: 8 }, () => submitWrite(actor, deps(s), { op: adjustOp(t, "-2", "8"), idempotencyKey: key, local: { entityType: "Package", entityId: "x" } })));
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(s.writesApplied).toHaveLength(1);
    expect(s.package(licenseA, t)?.quantity).toBe("8");
    const rows = await db.select().from(nms2sRequests).where(eq(nms2sRequests.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it("holds a write whose answer was lost, never resends it blindly, and settles it by lookup", async () => {
    const s = simulator();
    const t = tag();
    s.seedPackage(licenseA, { tag: t, quantity: "10", unit: "G", status: "Active" });
    const op = adjustOp(t, "-3", "7");
    const key = idempotencyKey(actor.facilityId, "UAT", `lost:${t}`);
    s.failNext({ kind: "TIMEOUT_AFTER_APPLY" });
    const lost = await submitWrite(actor, deps(s), { op, idempotencyKey: key, local: { entityType: "Package", entityId: "x" } });
    expect(lost).toMatchObject({ status: "UNKNOWN_OUTCOME", sent: true, errorKind: "UNKNOWN_OUTCOME" });
    const retry = await submitWrite(actor, deps(s), { op, idempotencyKey: key, local: { entityType: "Package", entityId: "x" } });
    expect(retry).toMatchObject({ status: "UNKNOWN_OUTCOME", sent: false });
    expect(s.writesApplied).toHaveLength(1);
    const settled = await lookupOutcome(actor, deps(s), lost.requestId, op);
    expect(settled).toMatchObject({ status: "RESOLVED_APPLIED" });
    expect(s.package(licenseA, t)?.quantity).toBe("7"); // applied exactly once
  });

  it("resends a write once the state confirms it was never applied", async () => {
    const s = simulator();
    const t = tag();
    s.seedPackage(licenseA, { tag: t, quantity: "10", unit: "G", status: "Active" });
    const op = adjustOp(t, "-1", "9");
    const key = idempotencyKey(actor.facilityId, "UAT", `timeout:${t}`);
    s.failNext({ kind: "TIMEOUT_BEFORE_APPLY" });
    const lost = await submitWrite(actor, { ...deps(s), config: { ...config, timeoutMs: 50 } }, { op, idempotencyKey: key, local: { entityType: "Package", entityId: "x" } });
    expect(lost.status).toBe("UNKNOWN_OUTCOME");
    expect(await lookupOutcome(actor, deps(s), lost.requestId, op)).toMatchObject({ status: "RETRYABLE" });
    expect(await submitWrite(actor, deps(s), { op, idempotencyKey: key, local: { entityType: "Package", entityId: "x" } })).toMatchObject({ status: "ACCEPTED", sent: true });
    expect(s.package(licenseA, t)?.quantity).toBe("9");
  });

  it("asks a person to settle an unknown outcome when the state can't be asked, and needs a note", async () => {
    const s = simulator({ supportsLookup: false, honorsIdempotencyKeys: false });
    const t = tag();
    s.seedPackage(licenseA, { tag: t, quantity: "10", unit: "G", status: "Active" });
    const op = adjustOp(t, "-1", "9");
    const key = idempotencyKey(actor.facilityId, "UAT", `manual:${t}`);
    s.failNext({ kind: "SERVER_ERROR" });
    const r = await submitWrite(actor, deps(s), { op, idempotencyKey: key, local: { entityType: "Package", entityId: "x" } });
    expect(r).toMatchObject({ status: "UNKNOWN_OUTCOME", errorKind: "SERVER_ERROR" });
    expect(await lookupOutcome(actor, deps(s), r.requestId, op)).toMatchObject({ status: "UNKNOWN_OUTCOME", detail: expect.stringMatching(/by hand/) });
    await expect(resolveByPerson(actor, r.requestId, { applied: true, note: " " })).rejects.toThrow(/what you checked/);
    await expect(resolveByPerson(other, r.requestId, { applied: true, note: "x" })).rejects.toThrow(/not found/); // other facility
    expect(await resolveByPerson(actor, r.requestId, { applied: false, note: "Not in NMS2S package history" })).toMatchObject({ status: "RETRYABLE" });
    const log = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "Nms2sRequest"), eq(auditLogs.entityId, r.requestId)));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["WRITE_UNKNOWN_OUTCOME", "RESOLVED_NOT_APPLIED"]));
    expect(log.find((l) => l.action === "RESOLVED_NOT_APPLIED")).toMatchObject({ userName: "Compliance Lead", reason: "Not in NMS2S package history" });
  });

  it("classifies refusals: retryable when never applied, final when rejected", async () => {
    const s = simulator();
    const t = tag();
    s.seedPackage(licenseA, { tag: t, quantity: "10", unit: "G", status: "Active" });
    const send = (k: string, op = adjustOp(t, "-1", "9")) => submitWrite(actor, deps(s), { op, idempotencyKey: idempotencyKey(actor.facilityId, "UAT", k + t), local: { entityType: "Package", entityId: "x" } });
    s.failNext({ kind: "NETWORK_BEFORE_SEND" });
    expect(await send("net")).toMatchObject({ status: "RETRYABLE", errorKind: "NETWORK_BEFORE_SEND" });
    expect(await send("net")).toMatchObject({ status: "ACCEPTED", sent: true });
    s.failNext({ kind: "AUTH_FAILED" });
    expect(await send("auth")).toMatchObject({ status: "RETRYABLE", errorKind: "AUTH_FAILED" });
    s.failNext({ kind: "RATE_LIMITED", retryAfterSeconds: 10 });
    expect(await send("rate")).toMatchObject({ status: "UNKNOWN_OUTCOME", errorKind: "RATE_LIMITED" });
    expect(await send("malformed", { ...adjustOp(t, "abc", "x") })).toMatchObject({ status: "REJECTED", errorKind: "MALFORMED" });
    expect(await send("neg", adjustOp(t, "-500", "-490"))).toMatchObject({ status: "REJECTED", errorKind: "REJECTED" });
    // The wrong facility's credentials: the simulator refuses, nothing is applied.
    const forbidden = await submitWrite(actor, { ...deps(s), credentials: { apiKey: OTHER_SECRET } }, { op: adjustOp(t, "-1", "8"), idempotencyKey: idempotencyKey(actor.facilityId, "UAT", `forbid${t}`), local: { entityType: "Package", entityId: "x" } });
    expect(forbidden).toMatchObject({ status: "RETRYABLE", errorKind: "FORBIDDEN" });
    expect(s.package(licenseA, t)?.quantity).toBe("9");
  });

  it("treats a request left in flight by a stopped worker as unknown, not as safe to resend", async () => {
    const s = simulator();
    const key = idempotencyKey(actor.facilityId, "UAT", `stale:${run}`);
    const [row] = await db
      .insert(nms2sRequests)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, environment: "UAT", transport: "SIMULATOR", operation: "PACKAGE_ADJUST", idempotencyKey: key, requestHash: "h", localEntityType: "Package", localEntityId: "x", status: "IN_FLIGHT", attempts: 1, leaseUntil: new Date(Date.now() - 1000) })
      .returning();
    expect(await expireLeases(actor)).toBeGreaterThanOrEqual(1);
    const [after] = await db.select().from(nms2sRequests).where(eq(nms2sRequests.id, row.id));
    expect(after.status).toBe("UNKNOWN_OUTCOME");
    expect(s.calls).toHaveLength(0);
  });

  it("refuses production and does not let the simulator stand in for it", async () => {
    const s = simulator();
    await expect(submitWrite(actor, { transport: s, environment: "PRODUCTION", config }, { op: adjustOp("X", "-1", "1"), idempotencyKey: "k", local: { entityType: "Package", entityId: "x" } })).rejects.toMatchObject({ kind: "TRAFFIC_DISABLED" });
    const rows = await db.select().from(nms2sRequests).where(eq(nms2sRequests.environment, "PRODUCTION"));
    expect(rows).toHaveLength(0);
  });

  it("never puts a credential in the ledger or the audit log", async () => {
    const rows = await db.select().from(nms2sRequests).where(eq(nms2sRequests.orgId, actor.orgId));
    const log = await db.select().from(auditLogs).where(eq(auditLogs.orgId, actor.orgId));
    for (const text of [JSON.stringify(rows), JSON.stringify(log)]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(OTHER_SECRET);
    }
  });

  // ---- end to end through CannaTrace's own workflows ----------------------------------------

  it("reports a real adjustment and split from the inventory screens through the sync queue, once each", async () => {
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    const s = simulator();
    const pkg = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "100", locationId: shelf });
    s.seedPackage(licenseA, { tag: pkg.tag, quantity: "100", unit: "G", status: "Active" });
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "97.5", reasonCode: "DRYING", note: "cure loss" });
    const { children } = await splitPackage(actor, { packageId: pkg.id, parts: [{ tag: tag(), quantity: "20" }] });

    const adapter = nms2sAdapter(s, "UAT", { config });
    const first = await processQueue({ facilityId: actor.facilityId, adapters: { NMS2S: adapter } });
    expect(first.failed).toBe(0);
    expect(s.package(licenseA, pkg.tag)?.quantity).toBe("77.5");
    expect(s.package(licenseA, children[0].tag)?.quantity).toBe("20");
    const queued = await db.select().from(syncEvents).where(eq(syncEvents.facilityId, actor.facilityId)).orderBy(syncEvents.seq);
    const sent = queued.filter((e) => e.status === "SENT");
    expect(sent.map((e) => e.type)).toEqual(["PACKAGE_ADJUSTED", "PACKAGE_CREATED_FROM_PACKAGES"]);
    expect(sent.every((e) => e.externalId?.startsWith("SIM-TXN-"))).toBe(true);
    expect(queued.find((e) => e.type === "PACKAGE_RECEIVED")?.status).toBe("MANUAL"); // not automated: hand entry

    // The child's state id came back with the write and is now linked.
    const [link] = await db.select().from(nms2sIdMap).where(and(eq(nms2sIdMap.facilityId, actor.facilityId), eq(nms2sIdMap.localId, children[0].id)));
    expect(link).toMatchObject({ source: "WRITE_RESPONSE", stateId: s.package(licenseA, children[0].tag)?.stateId });

    // Running the queue again sends nothing new.
    const before = s.writesApplied.length;
    await processQueue({ facilityId: actor.facilityId, adapters: { NMS2S: adapter } });
    expect(s.writesApplied.length).toBe(before);
    // Merges and production share the event type but are not splits: they stay manual.
    const merge = { ...sent[1], payload: { after: { tag: "M", unit: "G", quantity: "5", from: ["A", "B"] } } };
    const made = { ...sent[1], payload: { after: { tag: "P", unit: "G", quantity: "5", from: "A", run: "Batch 1" } } };
    expect(toWriteOperation(merge)).toBeNull();
    expect(toWriteOperation(made)).toBeNull();
    expect(toWriteOperation(sent[0])).toMatchObject({ kind: "PACKAGE_ADJUST", quantityChange: "-2.5", reason: "Moisture loss / drying", note: "cure loss" });
  });

  it("holds the facility's queue behind a lost answer, in order, and recovers after it is settled", async () => {
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    const s = simulator();
    const pkg = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "50", locationId: shelf });
    s.seedPackage(licenseA, { tag: pkg.tag, quantity: "50", unit: "G", status: "Active" });
    await db.update(syncEvents).set({ status: "RESOLVED" }).where(eq(syncEvents.facilityId, actor.facilityId));
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "49", reasonCode: "DRYING" });
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "48", reasonCode: "DRYING" });
    const adapter = nms2sAdapter(s, "UAT", { config });

    s.failNext({ kind: "TIMEOUT_AFTER_APPLY" });
    const result = await processQueue({ facilityId: actor.facilityId, adapters: { NMS2S: adapter } });
    expect(result.failed).toBe(1);
    let queued = await db.select().from(syncEvents).where(and(eq(syncEvents.facilityId, actor.facilityId), eq(syncEvents.type, "PACKAGE_ADJUSTED"))).orderBy(syncEvents.seq);
    const held = queued.filter((e) => e.status !== "RESOLVED" && e.status !== "SENT");
    expect(held.map((e) => e.status)).toEqual(["FAILED", "PENDING"]);
    expect(held[0].lastErrorDetail).toMatch(/may have saved the record/);
    expect(s.package(licenseA, pkg.tag)?.quantity).toBe("49"); // the first one did land; the second was held back

    // The reconciliation shows the record as pending rather than as a false quantity difference.
    const rec = await runReconciliation(actor, { ...deps(s), statusMap });
    expect(rec.report.findings.find((f) => f.tag === pkg.tag)?.kind).toBe("PENDING_OUTCOME");

    // Settle it by lookup, then the queue continues and the second adjustment goes through exactly once.
    const [req] = await db.select().from(nms2sRequests).where(and(eq(nms2sRequests.syncEventId, held[0].id)));
    await lookupOutcome(actor, deps(s), req.id, toWriteOperation(held[0])!);
    await db.update(syncEvents).set({ status: "PENDING", nextAttemptAt: new Date(0) }).where(eq(syncEvents.id, held[0].id));
    await processQueue({ facilityId: actor.facilityId, adapters: { NMS2S: adapter } });
    queued = await db.select().from(syncEvents).where(and(eq(syncEvents.facilityId, actor.facilityId), eq(syncEvents.type, "PACKAGE_ADJUSTED"))).orderBy(syncEvents.seq);
    expect(queued.slice(-2).map((e) => e.status)).toEqual(["SENT", "SENT"]);
    expect(s.package(licenseA, pkg.tag)?.quantity).toBe("48");
  });

  it("reconciles a facility against the state, read-only, keeps facilities apart, and saves a permanent record", async () => {
    const s = simulator();
    const here = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "10", locationId: shelf });
    const differs = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "10", locationId: shelf });
    const onlyHere = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "4", locationId: shelf });
    s.seedPackage(licenseA, { tag: here.tag, quantity: "10", unit: "G", status: "Active" });
    s.seedPackage(licenseA, { tag: differs.tag, quantity: "9000", unit: "MG", status: "Active" });
    s.seedPackage(licenseA, { tag: `${run}-STATE-ONLY`, quantity: "3", unit: "G", status: "Active" });
    s.seedPackage(licenseB, { tag: `${run}-OTHER-LICENSE`, quantity: "1", unit: "G", status: "Active" });
    for (let i = 0; i < 450; i++) s.seedPackage(licenseA, { tag: `${run}-OLD-${i}`, quantity: "0", unit: "G", status: "Finished" }); // forces several pages

    const quantities = async () => (await db.execute(sql`select tag, quantity::text from packages where facility_id = ${actor.facilityId} order by tag`)).rows;
    const qtyBefore = await quantities();
    const { id, report } = await runReconciliation(actor, { ...deps(s), statusMap });
    const kindOf = (t: string) => report.findings.find((f) => f.tag === t)?.kind;
    expect(kindOf(here.tag)).toBe("MATCH");
    expect(kindOf(differs.tag)).toBe("QUANTITY_DIFFERENCE");
    expect(kindOf(onlyHere.tag)).toBe("MISSING_STATE");
    expect(kindOf(`${run}-STATE-ONLY`)).toBe("MISSING_LOCAL");
    expect(kindOf(`${run}-OTHER-LICENSE`)).toBeUndefined(); // another facility's license is never read
    expect(s.calls.filter((c) => c.method === "listPackages").length).toBeGreaterThan(2);
    expect(s.calls.every((c) => c.license === licenseA)).toBe(true);
    expect(s.writesApplied).toHaveLength(0);
    expect(await quantities()).toEqual(qtyBefore);

    // A proposed link becomes real only when a person confirms it.
    const proposal = report.proposedLinks.find((p) => p.tag === here.tag)!;
    expect(await db.select().from(nms2sIdMap).where(eq(nms2sIdMap.localId, here.id))).toHaveLength(0);
    await confirmLink(actor, { environment: "UAT", entityType: "Package", localId: here.id, stateId: proposal.stateId });
    await expect(confirmLink(actor, { environment: "UAT", entityType: "Package", localId: here.id, stateId: "another" })).rejects.toThrow(/already linked/);
    await expect(confirmLink(other, { environment: "UAT", entityType: "Package", localId: here.id, stateId: "x" })).rejects.toThrow(/isn't in this facility/);

    // The saved run is permanent.
    await expect(db.update(nms2sReconciliations).set({ startedByName: "someone else" }).where(eq(nms2sReconciliations.id, id))).rejects.toThrow();
    await expect(db.delete(nms2sReconciliations).where(eq(nms2sReconciliations.id, id))).rejects.toThrow();

    // Facility B, read with its own credentials, sees only its own license.
    const b = await runReconciliation(other, { ...deps(s), statusMap });
    expect(b.report.findings.map((f) => f.tag)).toEqual([`${run}-OTHER-LICENSE`]);
  });

  it("retries a read page after a temporary failure and stops on a permission failure", async () => {
    const s = simulator();
    s.failNext({ kind: "SERVER_ERROR" });
    await expect(runReconciliation(actor, { ...deps(s), statusMap })).resolves.toBeTruthy();
    s.failNext({ kind: "FORBIDDEN" });
    await expect(runReconciliation(actor, { ...deps(s), statusMap })).rejects.toMatchObject({ kind: "FORBIDDEN" });
    s.failNext({ kind: "AUTH_FAILED" });
    await expect(runReconciliation(actor, { ...deps(s), statusMap })).rejects.toMatchObject({ kind: "AUTH_FAILED" });
    const saved = await db.select().from(nms2sReconciliations).where(like(nms2sReconciliations.facilityId, actor.facilityId));
    expect(saved.length).toBeGreaterThanOrEqual(2);
  });
});
