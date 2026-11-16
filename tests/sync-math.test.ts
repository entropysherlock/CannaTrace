import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, RETRY_MINUTES, classifyHttpStatus, describeEvent, eventTypeFor, explainError, nextRetryAt } from "../src/lib/sync-math";

describe("which changes are reported", () => {
  it("maps inventory, plant, harvest, transfer, and sale changes", () => {
    expect(eventTypeFor("Package", "ADJUST")).toBe("PACKAGE_ADJUSTED");
    expect(eventTypeFor("Plant", "DESTROY")).toBe("PLANT_DESTROYED");
    expect(eventTypeFor("Harvest", "WASTE")).toBe("HARVEST_WASTE_RECORDED");
    expect(eventTypeFor("Order", "SHIP")).toBe("TRANSFER_SHIPPED");
    expect(eventTypeFor("Sale", "COMPLETE")).toBe("RETAIL_SALE");
  });
  it("ignores internal bookkeeping", () => {
    expect(eventTypeFor("Package", "ON_HOLD")).toBeNull();
    expect(eventTypeFor("User", "CREATE")).toBeNull();
    expect(eventTypeFor("Order", "CONFIRM")).toBeNull();
    expect(eventTypeFor("Drawer", "CLOSE")).toBeNull();
  });
});

describe("plain-English summaries", () => {
  it("describes an adjustment with before and after", () => {
    expect(
      describeEvent("PACKAGE_ADJUSTED", { tag: "CT-1", quantity: "100.0000", unit: "G" }, { tag: "CT-1", quantity: "98.5000", unit: "G" }),
    ).toBe("Adjusted package CT-1 from 100 to 98.5 g");
  });
  it("describes a sale and a shipment", () => {
    expect(describeEvent("RETAIL_SALE", null, { number: "S-00007", total: "98.95" })).toBe("Retail sale S-00007 for $98.95");
    expect(describeEvent("TRANSFER_SHIPPED", null, { packages: 1, manifestNumber: "MAN-00003" })).toBe("Shipped 1 package on manifest MAN-00003");
  });
  it("gets singular and plural right", () => {
    expect(describeEvent("PLANT_BATCH_PLANTS_DESTROYED", null, { destroyed: 1 })).toBe("Destroyed 1 untagged plant from a batch");
    expect(describeEvent("PLANTS_TAGGED", null, { tagged: 3, firstTag: "A1", lastTag: "A3" })).toBe("Tagged 3 plants (A1 to A3)");
  });
  it("falls back to readable text for anything unexpected", () => {
    expect(describeEvent("SOMETHING_NEW", null, null)).toBe("something new");
  });
});

describe("error handling", () => {
  it("retries only what can fix itself", () => {
    expect(classifyHttpStatus(401)).toEqual({ code: "AUTH_FAILED", retryable: false });
    expect(classifyHttpStatus(403)).toEqual({ code: "FORBIDDEN", retryable: false });
    expect(classifyHttpStatus(404)).toEqual({ code: "NOT_FOUND", retryable: false });
    expect(classifyHttpStatus(400)).toEqual({ code: "REJECTED", retryable: false });
    expect(classifyHttpStatus(429)).toEqual({ code: "RATE_LIMITED", retryable: true });
    expect(classifyHttpStatus(503)).toEqual({ code: "SERVER_ERROR", retryable: true });
  });
  it("backs off, then gives up after the last retry", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(nextRetryAt(1, now)!.toISOString()).toBe("2026-11-16T12:01:00.000Z");
    expect(nextRetryAt(2, now)!.toISOString()).toBe("2026-11-16T12:05:00.000Z");
    expect(nextRetryAt(RETRY_MINUTES.length, now)!.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(nextRetryAt(MAX_ATTEMPTS, now)).toBeNull();
  });
  it("explains every error kind with a meaning and a next step", () => {
    for (const code of ["NOT_CONFIGURED", "AUTH_FAILED", "FORBIDDEN", "NOT_FOUND", "REJECTED", "DUPLICATE", "RATE_LIMITED", "SERVER_ERROR", "NETWORK", "UNKNOWN", null]) {
      const e = explainError(code, "METRC");
      expect(e.title.length).toBeGreaterThan(10);
      expect(e.meaning.length).toBeGreaterThan(20);
      expect(e.fix.length).toBeGreaterThan(10);
      expect(`${e.title}${e.meaning}${e.fix}`).not.toMatch(/undefined|null|\b[45]\d\d\b/);
    }
    expect(explainError("AUTH_FAILED", "METRC").title).toBe("Metrc did not accept the sign-in");
  });
});
