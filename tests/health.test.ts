import { afterAll, describe, expect, it, vi } from "vitest";

describe("health check", () => {
  afterAll(() => vi.resetModules());

  it("says ok when the database answers, and shares nothing else", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: { execute: async () => [{ "?column?": 1 }] } }));
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(Object.keys(body).sort()).toEqual(["database", "ms", "status"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 when the database cannot be reached", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: { execute: async () => { throw new Error("connection refused to secret-host"); } } }));
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("down");
    expect(text).not.toContain("secret-host");
  });
});
