/**
 * Project Apex: independent probes for the ten QA findings, run against the real code and a real database.
 * Every test asserts the CORRECT behaviour, so a failing test means the finding is still present on this commit.
 */
import { and, eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { facilities, itemCategories, items, linkedDevices, locations, organizations, packages, saleLines, sales, tallyAttachments, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { addLabResult, receivePackage as receiveRaw, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { recordOfflineSale } from "@/lib/offline-sales";
import type { OfflineSale } from "@/lib/offline-types";
import { openDrawer, saveRetailSettings, setMenuItem } from "@/lib/pos";
import { pageParams } from "@/lib/api";
import { parseIdBarcode } from "@/lib/pos-math";
import { permissionsFor } from "@/lib/rbac";
import type { Session } from "@/lib/session";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `AX${Date.now().toString(36).toUpperCase()}`;
const today = todayIn();
let actor: Actor;
let session: Session;
let jar: string;
let papers: string;
let drawerId: string;
let floor: string;
let n = 0;

const sale = (over: Partial<OfflineSale> = {}): OfflineSale => ({
  offlineId: crypto.randomUUID(),
  localNumber: `OFF-${++n}`,
  facilityId: actor.facilityId,
  sellerId: actor.userId,
  sellerName: actor.userName,
  drawerId,
  soldAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  customerType: "ADULT_USE",
  birthDate: "1990-05-05",
  idExpires: addDays(today, 400),
  // 2 papers at $2 = $4.00; 14% excise 0.56, 7.625% sales tax 0.31 => 4.87
  lines: [{ itemId: papers, name: "Papers", quantity: "2", unitPrice: "2.00" }],
  discount: null,
  rates: { exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true },
  total: "4.87",
  cashTendered: "10.00",
  changeDue: "5.13",
  ...over,
});

describe.skipIf(!hasDb)("Apex: the ten earlier findings", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Apex Org ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Apex Shop", licenseNumber: `${run}-A`, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Ada Apex", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Floor", type: "ROOM" }).returning();
    floor = location.id;
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();
    const made = await db.insert(items).values(["Jar 3.5", "Papers"].map((name, i) => ({ orgId: org.id, name, sku: `${run}-${i}`, categoryId: category.id, unit: "EACH" as const }))).returning();
    [jar, papers] = made.map((i) => i.id);
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    session = { userId: user.id, orgId: org.id, facilityId: facility.id, name: user.name, role: "OWNER", permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    await setMenuItem(actor, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    await setMenuItem(actor, { itemId: papers, price: "2", limitCategory: "NONE" });
    for (const [itemId, quantity] of [[jar, "30"], [papers, "50"]]) {
      const pkg = await receiveRaw(actor, { tag: `${run}-${itemId.slice(0, 4)}`, itemId, quantity, locationId: location.id });
      await addLabResult(actor, { packageId: pkg.id, labName: "Lab", status: "PASS", thcPercent: "20" });
    }
    drawerId = (await openDrawer(actor, { openingCash: "100" })).id;
  });
  afterAll(() => pool.end());

  it("F1: an offline sale is booked at the tax rates the customer was charged, not today's rates", async () => {
    await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "10", salesTaxPercent: "5", medicalTaxExempt: true });
    try {
      const result = await recordOfflineSale(actor, sale());
      const [row] = await db.select().from(sales).where(eq(sales.id, result.saleId));
      expect(row.total).toBe("4.87");
      expect(row.exciseTax).toBe("0.56");
      expect(row.salesTax).toBe("0.31");
      expect(row.changeDue).toBe("5.13");
    } finally {
      await saveRetailSettings(actor, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    }
  });

  it("F2: deleting an upload does not give back the daily upload allowance", async () => {
    process.env.TALLY_UPLOADS_PER_DAY = "3";
    const { startUpload, deleteAttachment } = await import("@/lib/assistant/attachments/store");
    try {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await startUpload(session, { name: `a${i}.png`, size: 1000 })).id);
      await expect(startUpload(session, { name: "over.png", size: 1000 })).rejects.toThrow(/most allowed/);
      for (const id of ids) await deleteAttachment(session, id);
      await expect(startUpload(session, { name: "again.png", size: 1000 })).rejects.toThrow(/most allowed/);
    } finally {
      delete process.env.TALLY_UPLOADS_PER_DAY;
      await db.delete(tallyAttachments).where(eq(tallyAttachments.orgId, actor.orgId));
    }
  });

  it("F3: odd pagination values never reach the database as an error", async () => {
    for (const [limit, offset] of [["10.7", "0"], ["abc", "1.5"], ["5", "1e30"], ["5", "Infinity"], ["-3", "-9"], ["1e400", "x"]]) {
      const url = new URL(`http://x/api/v1/items?limit=${limit}&offset=${offset}`);
      const p = pageParams(url);
      expect(Number.isSafeInteger(p.limit) && Number.isSafeInteger(p.offset), `limit=${limit} offset=${offset} -> ${JSON.stringify(p)}`).toBe(true);
      await db.select({ id: items.id }).from(items).limit(p.limit).offset(p.offset);
    }
  });

  it("F4: malformed offline sales are refused with a message, never a server error", async () => {
    const bad: [string, unknown][] = [
      ["null line", sale({ lines: [null as never] })],
      ["line is a string", sale({ lines: ["x" as never] })],
      ["itemId not a uuid", sale({ lines: [{ itemId: "not-a-uuid", name: "x", quantity: "1", unitPrice: "1" }] })],
      ["itemId missing", sale({ lines: [{ name: "x", quantity: "1", unitPrice: "1" } as never] })],
      ["discount is a string", sale({ discount: "10%" as never })],
      ["discount percent is an object", sale({ discount: { name: "x", percent: {} as never } })],
      ["sellerId not a uuid", sale({ sellerId: "nope" })],
      ["drawerId not a uuid", sale({ drawerId: "nope" })],
      ["soldAt is an object", sale({ soldAt: {} as never })],
      ["facilityId missing", sale({ facilityId: undefined as never })],
      ["quantity is an array", sale({ lines: [{ itemId: papers, name: "x", quantity: [1] as never, unitPrice: "1" }] })],
      ["name is huge object", sale({ lines: [{ itemId: papers, name: { a: 1 } as never, quantity: "1", unitPrice: "2" }] })],
      ["calendar date", sale({ birthDate: "1990-02-31" })],
    ];
    for (const [what, input] of bad) {
      let err: unknown = null;
      try {
        await recordOfflineSale(actor, input as OfflineSale);
      } catch (e) {
        err = e;
      }
      // Either it is recorded cleanly or it is refused with an InventoryError. Anything else becomes HTTP 500.
      if (err) expect(err instanceof InventoryError, `${what}: ${(err as Error)?.constructor?.name}: ${(err as Error)?.message?.slice(0, 120)}`).toBe(true);
    }
  });

  it("F5: a revoked linked device can no longer sign in", async () => {
    const { createPairing, redeemPairing, deviceSession, revokeDevice, listDevices } = await import("@/lib/devices");
    const pairing = await createPairing(session);
    const redeemed = await redeemPairing(pairing.code, "Mozilla/5.0 (Linux; Android 14) Chrome/120");
    expect(redeemed).not.toBeNull();
    expect(await deviceSession(redeemed!.deviceToken)).not.toBeNull();
    const mine = (await listDevices(session)).find((d) => d.mine || true)!;
    await revokeDevice(session, mine.id);
    expect(await deviceSession(redeemed!.deviceToken)).toBeNull();
  });

  it("F6: password-change timestamps agree with sign-in and device times to the second", async () => {
    const { signInStillValid } = await import("@/lib/sign-in-check");
    const { createPairing, redeemPairing, deviceSession } = await import("@/lib/devices");
    const second = Math.floor(Date.now() / 1000);
    // A password change stamps the start of its second (whole seconds); a sign-in made in that same second counts.
    await db.update(users).set({ passwordChangedAt: new Date(second * 1000) }).where(eq(users.id, actor.userId));
    expect(await signInStillValid(actor.userId, second)).toBe(true);
    expect(await signInStillValid(actor.userId, second - 1)).toBe(false);
    // A phone linked BEFORE the change, in the same second, must not survive it.
    await db.update(users).set({ passwordChangedAt: null }).where(eq(users.id, actor.userId));
    const pairing = await createPairing(session);
    const redeemed = await redeemPairing(pairing.code, "Mozilla/5.0 (Linux; Android 14) Chrome/120");
    const [device] = await db.select().from(linkedDevices).where(and(eq(linkedDevices.userId, actor.userId), sql`revoked_at is null`)).orderBy(sql`created_at desc`).limit(1);
    const changedSameSecond = new Date(Math.floor(device.createdAt.getTime() / 1000) * 1000);
    await db.update(users).set({ passwordChangedAt: changedSameSecond }).where(eq(users.id, actor.userId));
    expect(await deviceSession(redeemed!.deviceToken)).toBeNull();
    await db.update(users).set({ passwordChangedAt: null }).where(eq(users.id, actor.userId));
  });

  it("F7: two Undo requests at once undo a Tally change exactly once", async () => {
    const { TOOLS } = await import("@/lib/assistant/tools");
    const { confirmProposal } = await import("@/lib/assistant/engine");
    const { undoChange } = await import("@/lib/assistant/changes");
    type Card = { title: string; action: { tool: string; args: Record<string, string> } };
    const propose = (name: string, input: Record<string, unknown>) => (TOOLS.find((t) => t.name === name) as unknown as { propose: (s: Session, i: Record<string, unknown>) => Promise<Card> }).propose(session, input);
    const card = await propose("receive_packages", { location: "Floor", packages: [{ item: "Jar", quantity: "2", first_tag: `${run}-UNDO1`, count: 3 }], expected_count: 3 });
    const token = await new SignJWT({ action: card.action, title: card.title, uid: session.userId, org: session.orgId, fac: session.facilityId })
      .setProtectedHeader({ alg: "HS256" }).setJti(crypto.randomUUID().replace(/-/g, "")).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(`assistant:${process.env.AUTH_SECRET}`));
    const done = await confirmProposal(session, token);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => undoChange(actor, done.changeId!)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const left = await db.select().from(packages).where(and(eq(packages.orgId, actor.orgId), sql`tag like ${`${run}-UNDO%`}`));
    expect(left).toHaveLength(3);
    expect(left.every((p) => p.status === "FINISHED" && Number(p.quantity) === 0)).toBe(true);
  });

  it("F8: a sale keeps the purchase-limit class the item had when it was sold, even when the item changes later", async () => {
    const result = await recordOfflineSale(actor, sale({ lines: [{ itemId: jar, name: "Jar 3.5", quantity: "1", unitPrice: "35.00" }], total: "42.44", cashTendered: "50.00", changeDue: "7.56" }));
    await setMenuItem(actor, { itemId: jar, price: "35", limitCategory: "NONE" });
    try {
      const lines = await db.select().from(saleLines).where(eq(saleLines.saleId, result.saleId));
      expect(lines[0].limitCategory).toBe("FLOWER");
      expect(Number(lines[0].limitPerUnit)).toBe(3.5);
    } finally {
      await setMenuItem(actor, { itemId: jar, price: "35", limitCategory: "FLOWER", limitPerUnit: "3.5" });
    }
  });

  it("F9: ID barcodes with impossible calendar dates are not accepted", () => {
    const card = (dbb: string, dba: string) => `@\n\x1e\rANSI 636000090002DL00410288ZA03290015DLDAQ1234567\nDCSDOE\nDACJOHN\nDBB${dbb}\nDBA${dba}\nDAJNM\n`;
    expect(parseIdBarcode(card("02311990", "01012030"))).toBeNull();
    expect(parseIdBarcode(card("04311990", "01012030"))).toBeNull();
    expect(parseIdBarcode(card("02291991", "01012030"))).toBeNull();
    expect(parseIdBarcode(card("02291992", "01012030"))?.birthDate).toBe("1992-02-29");
    expect(parseIdBarcode(card("05051990", "13012030"))).toBeNull();
  });

  it("F10: a Tally Undo that saved is reported as done even if the follow-up refresh fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), currentSession: async () => session }));
    vi.doMock("@/lib/watch", async (orig) => ({ ...(await orig<typeof import("@/lib/watch")>()), refreshWatch: async () => { throw new Error("refresh exploded"); } }));
    const { TOOLS } = await import("@/lib/assistant/tools");
    const { confirmProposal } = await import("@/lib/assistant/engine");
    const { POST } = await import("@/app/api/assistant/undo/route");
    type Card = { title: string; action: { tool: string; args: Record<string, string> } };
    const card = await (TOOLS.find((t) => t.name === "receive_packages") as unknown as { propose: (s: Session, i: Record<string, unknown>) => Promise<Card> }).propose(session, { location: "Floor", packages: [{ item: "Jar", quantity: "1", tag: `${run}-F10` }] });
    const token = await new SignJWT({ action: card.action, title: card.title, uid: session.userId, org: session.orgId, fac: session.facilityId })
      .setProtectedHeader({ alg: "HS256" }).setJti(crypto.randomUUID().replace(/-/g, "")).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(`assistant:${process.env.AUTH_SECRET}`));
    const done = await confirmProposal(session, token);
    const res = await POST(new Request("http://x/api/assistant/undo", { method: "POST", body: JSON.stringify({ changeId: done.changeId }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toMatch(/^Undone/);
    vi.doUnmock("@/lib/session");
    vi.doUnmock("@/lib/watch");
  });
});
