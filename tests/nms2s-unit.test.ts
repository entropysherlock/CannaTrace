import { describe, expect, it } from "vitest";
import { openSecretFor, sealSecretFor } from "@/lib/ai/secret-box";
import { assertCallAllowed, OFFICIAL_SPEC, PRODUCTION_APPROVAL_PHRASE, readConfig } from "@/lib/nms2s/config";
import { Nms2sError, readRetry, toNms2sError, writeRetry } from "@/lib/nms2s/errors";
import { officialTransport } from "@/lib/nms2s/official-transport";
import { reconcile, type LocalRecord } from "@/lib/nms2s/reconcile";
import { hint, redact, REDACTED, scrub } from "@/lib/nms2s/redact";
import { Nms2sSimulator, SIMULATOR_NOTICE } from "@/lib/nms2s/simulator";
import type { CallContext, StatePackage } from "@/lib/nms2s/types";

/*
 * Unit tests for the NMS2S preparation layer. Everything here runs against CannaTrace's own code and
 * its UNOFFICIAL simulator. None of it says anything about the real NMS2S API.
 */

const ctx = (licenseNumber: string, apiKey = "sim-key-aaaa"): CallContext => ({ environment: "UAT", facilityId: "f1", licenseNumber, credentials: { apiKey } });

describe("NMS2S configuration gate", () => {
  it("is off unless the environment is set, and never guesses a URL", () => {
    expect(readConfig({})).toEqual({ environment: null, baseUrl: null, trafficEnabled: false, productionApproved: false, timeoutMs: 15000 });
    expect(readConfig({ NMS2S_ENVIRONMENT: "uat" }).baseUrl).toBeNull();
    expect(readConfig({ NMS2S_ENVIRONMENT: "UAT", NMS2S_UAT_BASE_URL: " https://uat.example.invalid ", NMS2S_PRODUCTION_BASE_URL: "https://prod.example.invalid" }).baseUrl).toBe("https://uat.example.invalid");
    expect(readConfig({ NMS2S_ENVIRONMENT: "nonsense" }).environment).toBeNull();
    expect(readConfig({ NMS2S_TIMEOUT_MS: "5" }).timeoutMs).toBe(15000);
    expect(readConfig({ NMS2S_PRODUCTION_APPROVED: "yes" }).productionApproved).toBe(false);
    expect(readConfig({ NMS2S_PRODUCTION_APPROVED: PRODUCTION_APPROVAL_PHRASE }).productionApproved).toBe(true);
  });

  it("refuses every official call while the specification is pending, even with everything switched on", () => {
    expect(OFFICIAL_SPEC).toBeNull();
    const all = readConfig({ NMS2S_ENVIRONMENT: "UAT", NMS2S_UAT_BASE_URL: "https://uat.example.invalid", NMS2S_TRAFFIC_ENABLED: "1" });
    expect(() => assertCallAllowed(all, "UAT", "OFFICIAL")).toThrow(expect.objectContaining({ kind: "SPEC_PENDING" }));
  });

  it("lets the simulator run outside production only", () => {
    expect(() => assertCallAllowed(readConfig({}), "UAT", "SIMULATOR")).not.toThrow();
    expect(() => assertCallAllowed(readConfig({}), "PRODUCTION", "SIMULATOR")).toThrow(expect.objectContaining({ kind: "TRAFFIC_DISABLED" }));
    expect(() => assertCallAllowed(readConfig({ NMS2S_ENVIRONMENT: "PRODUCTION" }), "UAT", "SIMULATOR")).toThrow(expect.objectContaining({ kind: "TRAFFIC_DISABLED" }));
  });

  it("has an official transport that refuses everything and claims no capability", async () => {
    const t = officialTransport();
    expect(Object.values(t.capabilities().writes)).toEqual(["UNKNOWN", "UNKNOWN"]);
    expect(t.capabilities().idempotencyKeys).toBe("UNKNOWN");
    await expect(t.listPackages(ctx("L1"), { pageSize: 10 })).rejects.toMatchObject({ kind: "SPEC_PENDING" });
    await expect(t.submit(ctx("L1"), { kind: "PACKAGE_SPLIT", sourceTag: "A", newTag: "B", quantity: "1", unit: "G", note: null, occurredAt: "" }, "k")).rejects.toMatchObject({ kind: "SPEC_PENDING" });
  });
});

describe("NMS2S error policy", () => {
  it("never retries a write automatically when it might already have been applied", () => {
    expect(writeRetry("UNKNOWN_OUTCOME")).toBe("RECONCILE_FIRST");
    expect(writeRetry("SERVER_ERROR")).toBe("RECONCILE_FIRST");
    expect(writeRetry("RATE_LIMITED")).toBe("RECONCILE_FIRST"); // until the spec confirms throttled writes are not applied
    expect(writeRetry("RATE_LIMITED", new Set(["RATE_LIMITED"]))).toBe("AUTOMATIC");
    expect(writeRetry("NETWORK_BEFORE_SEND")).toBe("AUTOMATIC");
    expect(writeRetry("AUTH_FAILED")).toBe("AFTER_FIX");
    expect(writeRetry("REJECTED")).toBe("NEVER");
    expect(writeRetry("MALFORMED")).toBe("NEVER");
  });

  it("retries reads freely, since they change nothing", () => {
    expect(readRetry("SERVER_ERROR")).toBe("AUTOMATIC");
    expect(readRetry("UNKNOWN_OUTCOME")).toBe("AUTOMATIC");
    expect(readRetry("FORBIDDEN")).toBe("AFTER_FIX");
    expect(readRetry("MALFORMED")).toBe("NEVER");
  });

  it("treats a timeout or any unexpected exception as an unknown outcome", () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    expect(toNms2sError(abort).kind).toBe("UNKNOWN_OUTCOME");
    expect(toNms2sError(new TypeError("fetch failed")).kind).toBe("UNKNOWN_OUTCOME");
    expect(toNms2sError(new Nms2sError("REJECTED", "no")).kind).toBe("REJECTED");
  });
});

describe("NMS2S credential handling", () => {
  it("redacts secret-looking keys and known values, and keeps everything else", () => {
    const out = redact({ apiKey: "abcd1234efgh", nested: { Authorization: "Bearer zzz", note: "used abcd1234efgh today", count: 3 }, list: [{ password: "p" }] }, ["abcd1234efgh"]);
    expect(out).toEqual({ apiKey: REDACTED, nested: { Authorization: REDACTED, note: `used ${REDACTED} today`, count: 3 }, list: [{ password: REDACTED }] });
    expect(scrub("header Bearer eyJhbGciOi.payload.sig and Basic dXNlcjpwYXNz")).toBe(`header Bearer ${REDACTED} and Basic ${REDACTED}`);
    expect(scrub("x".repeat(600)).length).toBeLessThanOrEqual(501);
    expect(hint("short")).toBe("…");
    expect(hint("0123456789abcd")).toBe("…abcd");
  });

  it("binds sealed credentials to their facility and environment", () => {
    process.env.AI_KEY_ENCRYPTION_KEY ||= "0".repeat(64);
    const sealed = sealSecretFor('{"apiKey":"k"}', "nms2s:org:fac-a:UAT");
    expect(sealed).not.toContain("apiKey");
    expect(openSecretFor(sealed, "nms2s:org:fac-a:UAT")).toBe('{"apiKey":"k"}');
    expect(() => openSecretFor(sealed, "nms2s:org:fac-b:UAT")).toThrow();
    expect(() => openSecretFor(sealed, "nms2s:org:fac-a:PRODUCTION")).toThrow();
  });
});

describe("Unofficial NMS2S simulator", () => {
  const sim = () => {
    const s = new Nms2sSimulator();
    s.addAccount("sim-key-aaaa", ["L1"]);
    s.addAccount("sim-key-bbbb", ["L2"]);
    s.addAccount("sim-key-read", ["L1"], { canWrite: false });
    return s;
  };

  it("labels itself as unofficial", () => {
    expect(new Nms2sSimulator().label).toBe(SIMULATOR_NOTICE);
    expect(SIMULATOR_NOTICE).toMatch(/Unofficial/);
    expect(SIMULATOR_NOTICE).toMatch(/Not the New Mexico NMS2S API/);
  });

  it("pages through records deterministically and rejects bad page requests", async () => {
    const s = sim();
    for (let i = 0; i < 7; i++) s.seedPackage("L1", { tag: `T-${i}`, quantity: "1", unit: "G", status: "Active" });
    const p1 = await s.listPackages(ctx("L1"), { pageSize: 3 });
    const p2 = await s.listPackages(ctx("L1"), { pageSize: 3, cursor: p1.nextCursor });
    const p3 = await s.listPackages(ctx("L1"), { pageSize: 3, cursor: p2.nextCursor });
    expect([...p1.records, ...p2.records, ...p3.records].map((r) => r.tag)).toEqual(["T-0", "T-1", "T-2", "T-3", "T-4", "T-5", "T-6"]);
    expect(p3.nextCursor).toBeNull();
    await expect(s.listPackages(ctx("L1"), { pageSize: 0 })).rejects.toMatchObject({ kind: "MALFORMED" });
    await expect(s.listPackages(ctx("L1"), { pageSize: 3, cursor: "!!!" })).rejects.toMatchObject({ kind: "MALFORMED" });
  });

  it("isolates licenses and checks credentials and permissions", async () => {
    const s = sim();
    s.seedPackage("L1", { tag: "ONLY-L1", quantity: "5", unit: "G", status: "Active" });
    expect((await s.listPackages(ctx("L2", "sim-key-bbbb"), { pageSize: 10 })).records).toEqual([]);
    await expect(s.listPackages(ctx("L1", "sim-key-bbbb"), { pageSize: 10 })).rejects.toMatchObject({ kind: "FORBIDDEN" });
    await expect(s.listPackages(ctx("L1", "wrong"), { pageSize: 10 })).rejects.toMatchObject({ kind: "AUTH_FAILED" });
    const op = { kind: "PACKAGE_ADJUST" as const, packageTag: "ONLY-L1", quantityChange: "-1", newQuantity: "4", unit: "G", reason: "Drying", note: null, occurredAt: "" };
    await expect(s.submit(ctx("L1", "sim-key-read"), op, "k1")).rejects.toMatchObject({ kind: "FORBIDDEN" });
    expect(s.writesApplied).toHaveLength(0);
  });

  it("applies authorized splits and adjustments, refuses bad ones, and honors request keys", async () => {
    const s = sim();
    s.seedPackage("L1", { tag: "SRC", quantity: "10", unit: "G", status: "Active" });
    const split = { kind: "PACKAGE_SPLIT" as const, sourceTag: "SRC", newTag: "CHILD", quantity: "4", unit: "G", note: null, occurredAt: "" };
    const first = await s.submit(ctx("L1"), split, "k-split");
    expect(first).toMatchObject({ outcome: "ACCEPTED", stateIds: [{ entityType: "Package", localTag: "CHILD" }] });
    expect(await s.submit(ctx("L1"), split, "k-split")).toMatchObject({ outcome: "DUPLICATE" });
    expect(s.package("L1", "SRC")?.quantity).toBe("6");
    expect(s.package("L1", "CHILD")?.quantity).toBe("4");
    await expect(s.submit(ctx("L1"), { ...split, newTag: "CHILD" }, "k-other")).rejects.toMatchObject({ kind: "REJECTED" });
    await expect(s.submit(ctx("L1"), { kind: "PACKAGE_ADJUST", packageTag: "SRC", quantityChange: "-7", newQuantity: "-1", unit: "G", reason: "x", note: null, occurredAt: "" }, "k-neg")).rejects.toMatchObject({ kind: "REJECTED" });
    await expect(s.submit(ctx("L1"), { kind: "PACKAGE_ADJUST", packageTag: "SRC", quantityChange: "lots", newQuantity: "", unit: "G", reason: "x", note: null, occurredAt: "" }, "k-bad")).rejects.toMatchObject({ kind: "MALFORMED" });
  });

  it("can lose an answer after applying, and says so on lookup", async () => {
    const s = sim();
    s.seedPackage("L1", { tag: "P", quantity: "10", unit: "G", status: "Active" });
    const op = { kind: "PACKAGE_ADJUST" as const, packageTag: "P", quantityChange: "-2", newQuantity: "8", unit: "G", reason: "Drying", note: null, occurredAt: "" };
    s.failNext({ kind: "TIMEOUT_AFTER_APPLY" });
    await expect(s.submit(ctx("L1"), op, "k")).rejects.toMatchObject({ kind: "UNKNOWN_OUTCOME" });
    expect(s.package("L1", "P")?.quantity).toBe("8");
    expect(await s.lookup(ctx("L1"), op, "k")).toMatchObject({ found: "APPLIED" });
    expect(await s.lookup(ctx("L1"), op, "never-sent")).toEqual({ found: "NOT_APPLIED" });
  });

  it("simulates rate limits, server errors and an API without request keys", async () => {
    const s = new Nms2sSimulator({ honorsIdempotencyKeys: false });
    s.addAccount("sim-key-aaaa", ["L1"]);
    s.seedPackage("L1", { tag: "P", quantity: "10", unit: "G", status: "Active" });
    s.failNext({ kind: "RATE_LIMITED", retryAfterSeconds: 30 }, { kind: "SERVER_ERROR" });
    await expect(s.listPackages(ctx("L1"), { pageSize: 5 })).rejects.toMatchObject({ kind: "RATE_LIMITED", retryAfterSeconds: 30 });
    await expect(s.listPackages(ctx("L1"), { pageSize: 5 })).rejects.toMatchObject({ kind: "SERVER_ERROR" });
    const op = { kind: "PACKAGE_ADJUST" as const, packageTag: "P", quantityChange: "-1", newQuantity: "9", unit: "G", reason: "x", note: null, occurredAt: "" };
    await s.submit(ctx("L1"), op, "same");
    await s.submit(ctx("L1"), op, "same");
    expect(s.package("L1", "P")?.quantity).toBe("8"); // applied twice: why CannaTrace never resends blindly
  });
});

describe("NMS2S reconciliation (pure)", () => {
  const L = "LIC-1";
  const pkg = (tag: string, quantity: string, status = "ACTIVE", unit = "G"): LocalRecord => ({ entityType: "Package", localId: `id-${tag}`, tag, licenseNumber: L, quantity, unit: unit as LocalRecord["unit"], status });
  const theirs = (tag: string, quantity: string | null, status: string | null = "Active", unit: string | null = "G", licenseNumber = L): StatePackage => ({ stateId: `s-${tag}`, tag, licenseNumber, quantity, unit, status });
  const statusMap = { Active: "OPEN", "On Hold": "OPEN", Finished: "CLOSED", Destroyed: "CLOSED" } as const;

  it("sorts every record into exactly one category and changes nothing", () => {
    const local = [
      pkg("MATCH", "10"),
      pkg("QTY", "10"),
      pkg("ONLY-HERE", "3"),
      pkg("STATUS", "0", "FINISHED"),
      pkg("PENDING", "7"),
      pkg("ELSEWHERE", "1"),
      pkg("ODD", "1"),
      pkg("COUNT", "4", "ACTIVE", "EACH"),
      pkg("LINKED", "2"),
      pkg("GRAMS", "1000"),
      pkg("CLOSED-BOTH", "0", "DESTROYED"),
    ];
    const state = [
      theirs("MATCH", "10"),
      theirs("QTY", "9.5"),
      theirs("STATUS", "5", "Active"),
      theirs("PENDING", "9"),
      theirs("ELSEWHERE", "1", "Active", "G", "LIC-OTHER"),
      theirs("ODD", "1", "Mystery"),
      theirs("COUNT", "4", "Active", "G"),
      theirs("LINKED", "2"),
      theirs("GRAMS", "1", "Active", "KG"),
      theirs("CLOSED-BOTH", "0", "Destroyed"),
      theirs("ONLY-THERE", "2"),
      theirs("GONE-THERE", "0", "Finished"),
    ];
    const frozenLocal = JSON.stringify(local);
    const frozenState = JSON.stringify(state);
    const report = reconcile({
      licenseNumber: L,
      local,
      statePackages: state,
      statePlants: [],
      pending: [{ localEntityType: "Package", localEntityId: "id-PENDING", tag: "PENDING", status: "UNKNOWN_OUTCOME", operation: "PACKAGE_ADJUST" }],
      links: [{ entityType: "Package", localId: "id-LINKED", stateId: "s-SOMETHING-ELSE" }],
      statusMap,
    });
    const byTag = Object.fromEntries(report.findings.map((f) => [f.tag, f.kind]));
    expect(byTag).toEqual({
      MATCH: "MATCH",
      QTY: "QUANTITY_DIFFERENCE",
      "ONLY-HERE": "MISSING_STATE",
      STATUS: "STATUS_DIFFERENCE",
      PENDING: "PENDING_OUTCOME",
      ELSEWHERE: "FACILITY_MISMATCH",
      ODD: "NOT_COMPARABLE",
      COUNT: "NOT_COMPARABLE",
      LINKED: "ID_MISMATCH",
      GRAMS: "MATCH",
      "CLOSED-BOTH": "MATCH",
      "ONLY-THERE": "MISSING_LOCAL",
    });
    expect(report.counts).toMatchObject({ MATCH: 3, QUANTITY_DIFFERENCE: 1, MISSING_LOCAL: 1, MISSING_STATE: 1, STATUS_DIFFERENCE: 1, FACILITY_MISMATCH: 1, ID_MISMATCH: 1, PENDING_OUTCOME: 1, NOT_COMPARABLE: 2 });
    expect(report.findings.find((f) => f.tag === "QTY")?.detail).toContain("difference -0.5");
    expect(report.proposedLinks.map((p) => p.tag)).toContain("MATCH");
    expect(report.proposedLinks.map((p) => p.tag)).not.toContain("LINKED");
    expect(JSON.stringify(local)).toBe(frozenLocal);
    expect(JSON.stringify(state)).toBe(frozenState);
  });

  it("reports unmapped state statuses instead of guessing, which is the default until the spec arrives", () => {
    const report = reconcile({ licenseNumber: L, local: [pkg("A", "1")], statePackages: [theirs("A", "1")], statePlants: [], pending: [], links: [] });
    expect(report.findings[0]).toMatchObject({ kind: "NOT_COMPARABLE", detail: expect.stringContaining('"Active" isn\'t mapped') });
  });

  it("compares plants by status", () => {
    const report = reconcile({
      licenseNumber: L,
      local: [{ entityType: "Plant", localId: "p1", tag: "PL-1", licenseNumber: L, quantity: null, unit: null, status: "HARVESTED" }],
      statePackages: [],
      statePlants: [{ stateId: "sp1", tag: "PL-1", licenseNumber: L, status: "Flowering" }],
      pending: [],
      links: [],
      statusMap: { Flowering: "OPEN" },
    });
    expect(report.findings[0].kind).toBe("STATUS_DIFFERENCE");
  });
});
