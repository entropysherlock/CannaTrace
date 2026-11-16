import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiKeys, customers, facilities, itemCategories, items, locations, organizations, packages, users, webhookDeliveries, webhooks } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { importCsv } from "@/lib/importer";
import {
  authenticateApiKey,
  checkWebhookUrl,
  createApiKey,
  createWebhook,
  isPrivateAddress,
  processWebhooks,
  revokeApiKey,
  setWebhookActive,
  signPayload,
  verifySignature,
} from "@/lib/integrations";
import { adjustPackage, receivePackage, setPackageStatus, type Actor } from "@/lib/inventory";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `I${Date.now().toString(36).toUpperCase()}`;
let n = 0;
const tag = () => `${run}-${String(++n).padStart(4, "0")}`;

let actor: Actor;
let item: string;
let shelf: string;

describe("webhook address safety", () => {
  it("spots private and local addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("accepts public https only", () => {
    expect(checkWebhookUrl("https://hooks.example.com/cannatrace").hostname).toBe("hooks.example.com");
    expect(() => checkWebhookUrl("http://hooks.example.com")).toThrow(/https/);
    expect(() => checkWebhookUrl("https://localhost/x")).toThrow(/public internet/);
    expect(() => checkWebhookUrl("https://169.254.169.254/latest")).toThrow(/public internet/);
    expect(() => checkWebhookUrl("https://[::1]/x")).toThrow(/public internet/);
    expect(() => checkWebhookUrl("https://user:pw@example.com")).toThrow(/username or password/);
    expect(() => checkWebhookUrl("not a url")).toThrow(/full web address/);
  });
});

describe("webhook signatures", () => {
  it("verifies a good signature and refuses tampering, other secrets, and old timestamps", () => {
    const now = 1_800_000_000;
    const header = signPayload("whsec_test", '{"a":1}', now);
    expect(verifySignature("whsec_test", '{"a":1}', header, now + 10)).toBe(true);
    expect(verifySignature("whsec_test", '{"a":2}', header, now)).toBe(false);
    expect(verifySignature("whsec_other", '{"a":1}', header, now)).toBe(false);
    expect(verifySignature("whsec_test", '{"a":1}', header, now + 301)).toBe(false);
    expect(verifySignature("whsec_test", '{"a":1}', "garbage", now)).toBe(false);
  });
});

describe.skipIf(!hasDb)("integrations (database)", () => {
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Int Org ${run}` }).returning();
    const [facility] = await db
      .insert(facilities)
      .values({ orgId: org.id, name: "Int", licenseNumber: `${run}-LIC`, licenseType: "CULTIVATION", state: "NM" })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ orgId: org.id, name: "Integrator", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" })
      .returning();
    const [location] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Vault", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const [made] = await db.insert(items).values({ orgId: org.id, name: "Bulk", sku: "BULK", categoryId: category.id, unit: "G" }).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    item = made.id;
    shelf = location.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("stores only a hash of API keys, and revoked keys stop working", async () => {
    const { key, prefix } = await createApiKey(actor, { name: "Accounting", canWrite: false });
    expect(key).toMatch(/^ct_[A-Za-z0-9_-]{32}$/);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.prefix, prefix));
    expect(row.keyHash).not.toContain(key.slice(3));
    expect((await authenticateApiKey(`Bearer ${key}`))?.id).toBe(row.id);
    expect(await authenticateApiKey(`Bearer ${key}x`)).toBeNull();
    expect(await authenticateApiKey(key)).toBeNull();
    expect(await authenticateApiKey(null)).toBeNull();
    await revokeApiKey(actor, { keyId: row.id });
    expect(await authenticateApiKey(`Bearer ${key}`)).toBeNull();
    await expect(createApiKey(actor, { name: " ", canWrite: true })).rejects.toThrow(/Name the key/);
  });

  it("queues signed deliveries only for subscribed events, retries failures, and stops when turned off", async () => {
    await expect(createWebhook(actor, { url: "https://hooks.example.com/a", events: [] })).rejects.toThrow(/at least one event/);
    const { secret } = await createWebhook(actor, { url: "https://hooks.example.com/a", events: ["PACKAGE_ADJUSTED"] });
    const pkg = await receivePackage(actor, { tag: tag(), itemId: item, quantity: "50", locationId: shelf });
    await setPackageStatus(actor, { packageId: pkg.id, status: "ON_HOLD", reason: "x" });
    await setPackageStatus(actor, { packageId: pkg.id, status: "ACTIVE", reason: "y" });
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "49", reasonCode: "SAMPLE" });
    const [hook] = await db.select().from(webhooks).where(eq(webhooks.facilityId, actor.facilityId));
    const queued = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id));
    expect(queued.map((d) => d.event)).toEqual(["PACKAGE_ADJUSTED"]);

    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    const answers = [new Response("busy", { status: 503 }), new Response("ok", { status: 200 })];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
      return answers.shift()!;
    }) as unknown as typeof fetch;

    const now = new Date(Date.now() + 1000);
    expect(await processWebhooks({ now, fetchImpl, allowPrivate: true })).toEqual({ delivered: 0, failed: 1 });
    let [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id));
    expect(d).toMatchObject({ status: "PENDING", attempts: 1, lastResponse: "503 busy" });

    expect(await processWebhooks({ now: new Date(now.getTime() + 61_000), fetchImpl, allowPrivate: true })).toEqual({ delivered: 1, failed: 0 });
    [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id));
    expect(d.status).toBe("DELIVERED");

    const last = sent[1];
    expect(last.url).toBe("https://hooks.example.com/a");
    expect(verifySignature(secret, last.body, last.headers["CannaTrace-Signature"], Math.floor((now.getTime() + 61_000) / 1000))).toBe(true);
    const body = JSON.parse(last.body);
    expect(body).toMatchObject({ id: d.id, event: "PACKAGE_ADJUSTED", data: { summary: `Adjusted package ${pkg.tag} from 50 to 49 g` } });

    await setWebhookActive(actor, { webhookId: hook.id, active: false });
    await adjustPackage(actor, { packageId: pkg.id, newQuantity: "48", reasonCode: "SAMPLE" });
    expect(await db.$count(webhookDeliveries, eq(webhookDeliveries.webhookId, hook.id))).toBe(1);
  });

  it("refuses to deliver to an address that resolves to a private network", async () => {
    await db.update(webhooks).set({ active: false }).where(eq(webhooks.facilityId, actor.facilityId));
    await createWebhook(actor, { url: "https://localtest.me/hook", events: ["PACKAGE_RECEIVED"] });
    await receivePackage(actor, { tag: tag(), itemId: item, quantity: "1", locationId: shelf });
    let called = false;
    const fetchImpl = (async () => ((called = true), new Response("ok"))) as unknown as typeof fetch;
    const lookup = await import("node:dns/promises").then((m) => m.lookup("localtest.me").catch(() => null));
    if (!lookup) return; // no DNS in this environment
    await processWebhooks({ now: new Date(Date.now() + 1000), fetchImpl });
    expect(called).toBe(false);
    const rows = await db.execute<{ status: string; last_response: string }>(
      sql`select d.status, d.last_response from webhook_deliveries d join webhooks w on w.id = d.webhook_id where w.url = 'https://localtest.me/hook'`,
    );
    expect(rows.rows[0]).toMatchObject({ status: "FAILED", last_response: expect.stringMatching(/private network/) });
  });

  it("imports all rows or none, listing every problem by line", async () => {
    await expect(
      importCsv(actor, "items", "name,sku,category,unit\nJar,JAR-1,Flower,EACH\nBad,,Flower,EACH\nOdd,ODD-1,Flower,BUSHEL\nDup,BULK,Flower,G\n"),
    ).rejects.toThrow(/Nothing was imported[\s\S]*Line 3: sku is empty[\s\S]*Line 4: unit must be one of[\s\S]*Line 5: SKU BULK already exists/);
    expect(await db.$count(items, eq(items.sku, "JAR-1"))).toBe(0);

    expect(await importCsv(actor, "items", "Name,SKU,Category,Unit,Strain\nJar,JAR-1,Packaged Flower,EACH,Blue\nRosin,ROS-1,Concentrates,G,\n")).toEqual({ count: 2 });
    expect(await importCsv(actor, "locations", "name,type\nRack 9,rack\nBin 4,BIN\n")).toEqual({ count: 2 });
    expect(await importCsv(actor, "customers", 'name,licenseNumber,licenseType,licenseExpires,address\n"Shop, LLC",lic-9,Retailer,2028-01-31,"1 Main St, Suite 2"\n')).toEqual({ count: 1 });
    const [customer] = await db.select().from(customers).where(eq(customers.licenseNumber, "LIC-9"));
    expect(customer).toMatchObject({ name: "Shop, LLC", address: "1 Main St, Suite 2", licenseVerifiedAt: null });

    const t1 = tag();
    const t2 = tag();
    await expect(
      importCsv(actor, "packages", `tag,sku,quantity,location\n${t1},JAR-1,10,Rack 9\n${t2},NOPE,5,Rack 9\n${tag()},JAR-1,5,Nowhere\n${t1},JAR-1,1,Rack 9\n`),
    ).rejects.toThrow(/Line 3: no item with SKU NOPE[\s\S]*Line 4: no location called Nowhere[\s\S]*Line 5: Tag .* already in use/);
    expect(await db.$count(packages, eq(packages.tag, t1))).toBe(0);
    expect(await importCsv(actor, "packages", `tag,sku,quantity,location,costPerUnit\n${t1},JAR-1,10,rack 9,4.5\n${t2},ROS-1,28.5,Bin 4,\n`)).toEqual({ count: 2 });
    const [pkg] = await db.select().from(packages).where(eq(packages.tag, t1));
    expect(new Decimal(pkg.costPerUnit!).toString()).toBe("4.5");

    await expect(importCsv(actor, "items", "name,sku\nx,y\n")).rejects.toThrow(/Missing: category, unit/);
  });
});
