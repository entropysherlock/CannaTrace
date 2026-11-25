// Project Apex II: API and sign-in hardening. APEX-19 (rate limit, pagination, escapes), APEX-20 (lockout and timing).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import type { LabelDesign } from "@/lib/labels/types";
import { facilities, itemCategories, items, organizations, users } from "@/db/schema";
import { API_REQUESTS_PER_MINUTE, safeDecode, takeApiRequest } from "@/lib/api";
import { db, pool } from "@/lib/db";
import { createApiKey } from "@/lib/integrations";
import { InventoryError } from "@/lib/inventory-math";
import { clearSignInFailures, MAX_PER_EMAIL, MAX_PER_EMAIL_ANYWHERE, recordSignInFailure, signInLocked } from "@/lib/sign-in-throttle";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `AH${Date.now().toString(36)}`;
let bearer: string;

describe.skipIf(!hasDb)("Apex II API and sign-in hardening", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Hard ${run}` }).returning();
    const [f] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: `${run}-F`, licenseType: "RETAIL", state: "NM" }).returning();
    const [u] = await db.insert(users).values({ orgId: org.id, name: "Own", email: `own.${run}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    await db.insert(items).values(Array.from({ length: 5 }, (_, i) => ({ orgId: org.id, name: `Item ${i}`, sku: `${run}-${i}`, categoryId: cat.id, unit: "EACH" as const })));
    bearer = (await createApiKey({ userId: u.id, userName: u.name, orgId: org.id, facilityId: f.id }, { name: "t", canWrite: false })).key;
  });
  afterAll(() => pool.end());

  const call = async (path: string) => {
    const mod = await import("@/app/api/v1/items/route");
    return mod.GET(new Request(`https://x.test${path}`, { headers: { authorization: `Bearer ${bearer}` } }), { params: Promise.resolve({}) });
  };

  it("APEX-19: the items list is paged like the others", async () => {
    const res = await call("/api/v1/items?limit=2");
    const body = (await res.json()) as { data: unknown[]; nextOffset: number | null };
    expect(body.data).toHaveLength(2);
    expect(body.nextOffset).toBe(2);
    const last = (await (await call("/api/v1/items?limit=2&offset=4")).json()) as { data: unknown[]; nextOffset: number | null };
    expect(last.data).toHaveLength(1);
    expect(last.nextOffset).toBeNull();
  });

  it("APEX-19: one API key cannot make more than its share of requests in a minute", async () => {
    const id = `key-${run}`;
    let ok = 0;
    for (let i = 0; i < API_REQUESTS_PER_MINUTE + 5; i++) if (await takeApiRequest(id)) ok++;
    expect(ok).toBe(API_REQUESTS_PER_MINUTE);
    expect(await takeApiRequest(`other-${run}`)).toBe(true);
  });

  it("APEX-19: a broken % escape in a tag is a clear error, not a server error", () => {
    expect(() => safeDecode("%E0%A4%A")).toThrow(InventoryError);
    expect(safeDecode("ABC%2D1")).toBe("ABC-1");
  });

  it("APEX-20: a stranger guessing at someone's email locks out only their own address", async () => {
    const email = `victim.${run}@test.invalid`;
    for (let i = 0; i < MAX_PER_EMAIL; i++) await recordSignInFailure(email, "198.51.100.66");
    expect(await signInLocked(email, "198.51.100.66")).toBe(true);
    expect(await signInLocked(email, "203.0.113.5")).toBe(false); // the real owner, from their own network
    await clearSignInFailures(email, "198.51.100.66");
    expect(await signInLocked(email, "198.51.100.66")).toBe(false);
  });

  it("APEX-20: spreading guesses over many addresses still trips the per-email limit", async () => {
    const email = `spread.${run}@test.invalid`;
    for (let i = 0; i < MAX_PER_EMAIL_ANYWHERE; i++) await recordSignInFailure(email, `192.0.2.${(i % 200) + 1}${i > 199 ? "0" : ""}`);
    expect(await signInLocked(email, "203.0.113.77")).toBe(true);
    await clearSignInFailures(email);
  });

  it("APEX-21: a label never loads a picture from a web address", () => {
    const design = (src: string) =>
      ({ widthMm: 50, heightMm: 30, elements: [{ id: "i", type: "image", x: 1, y: 1, w: 10, h: 10, src }] }) as unknown as LabelDesign;
    for (const src of ["https://tracker.example/pixel.png?u=1", "//tracker.example/x.png", "http://169.254.169.254/x", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="]) {
      expect(renderLabelSvg(design(src), {}), src).not.toContain("<image");
    }
    expect(renderLabelSvg(design("data:image/png;base64,iVBORw0KGgo="), {})).toContain("<image");
  });
});
