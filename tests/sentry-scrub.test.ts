import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent, scrubSpan } from "@/lib/sentry-options";

describe("crash reports carry no customer or store data", () => {
  it("strips cookies, bodies, headers, query strings, emails and typed input", () => {
    const event = {
      type: undefined,
      request: {
        url: "https://canna-trace.vercel.app/pos/sale?customer=Jane%20Doe&dob=1990-01-01",
        cookies: { session: "secret" },
        data: { idNumber: "D1234567" },
        headers: { authorization: "Bearer x" },
        query_string: "customer=Jane",
      },
      user: { id: "u1", email: "jane@example.com", ip_address: "1.2.3.4" },
      breadcrumbs: [
        { category: "fetch", data: { url: "/api/x?tag=1A4000" } },
        { category: "ui.input", message: "input[name=idNumber] D1234567" },
        { category: "navigation", data: { from: "/inventory?customer=Jane%20Doe", to: "/pos?q=Jane" } },
        { category: "console", message: "Jane Doe D1234567", data: { arguments: ["Jane Doe"] } },
      ],
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.request).toEqual({ url: "https://canna-trace.vercel.app/pos/sale" });
    expect(out.user).toEqual({ id: "u1" });
    expect(out.breadcrumbs?.[0].data?.url).toBe("/api/x");
    expect(out.breadcrumbs?.[1].message).toBeUndefined();
    expect(out.breadcrumbs?.[2].data).toEqual({ from: "/inventory", to: "/pos" });
    expect(out.breadcrumbs?.[3].message).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/Jane|D1234567|secret|1\.2\.3\.4|example\.com/);
  });
});

describe("performance traces carry no query strings", () => {
  it("strips queries from span URLs and the transaction name", () => {
    const event = {
      type: "transaction",
      transaction: "GET /pos?customer=Jane",
      spans: [{ data: { "http.url": "https://x/api?dob=1990", "url.query": "?dob=1990", "http.target": "/pos?customer=Jane" } }],
    } as unknown as ErrorEvent;
    const out = JSON.stringify(scrubEvent(event));
    expect(out).not.toMatch(/Jane|1990/);
    expect(out).toContain("https://x/api");
  });
});

describe("streamed spans carry no query strings or visitor IPs", () => {
  it("strips them", () => {
    const span = {
      trace_id: "t", span_id: "s", name: "GET /pos?customer=Jane", start_timestamp: 0, status: "ok", is_segment: true,
      attributes: { "url.full": "https://x/pos?customer=Jane", "http.target": "/pos?dob=1990", "url.query": "customer=Jane", "client.address": "9.9.9.9", "http.route": "/pos" },
    } as unknown as Parameters<typeof scrubSpan>[0];
    const out = JSON.stringify(scrubSpan(span));
    expect(out).not.toMatch(/Jane|1990|9\.9\.9\.9/);
    expect(out).toContain("/pos");
  });
});
