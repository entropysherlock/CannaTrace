import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-options";

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
