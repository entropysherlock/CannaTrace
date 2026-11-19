import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { businessIsListed } from "./access-members";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { apiKeys, webhookDeliveries, webhooks, type ApiKey, type Webhook } from "@/db/schema";
import { logAdminAction } from "./audit-log";
import { db, type Tx } from "./db";
import { InventoryError } from "./inventory-math";
import { nextRetryAt } from "./sync-math";

type Actor = { userId: string; userName: string; orgId: string; facilityId: string };

// ---------- API keys ----------

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Create a key. The full key is returned once and never stored; only its hash is kept. */
export async function createApiKey(actor: Actor, input: { name: string; canWrite: boolean }): Promise<{ key: string; prefix: string }> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new InventoryError("Name the key after what will use it, for example \"Accounting export\".");
  const key = `ct_${randomBytes(24).toString("base64url")}`;
  const prefix = key.slice(0, 10);
  await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(apiKeys)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        name,
        prefix,
        keyHash: hashKey(key),
        canWrite: input.canWrite,
        createdByName: actor.userName,
      })
      .returning({ id: apiKeys.id });
    // The prefix identifies the key; the key itself is never logged.
    await logAdminAction(tx, actor, { entityType: "ApiKey", entityId: made.id, action: "CREATE", after: { name, prefix, canWrite: input.canWrite } });
  });
  return { key, prefix };
}

export async function revokeApiKey(actor: Actor, input: { keyId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, input.keyId), eq(apiKeys.orgId, actor.orgId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix });
    if (gone) await logAdminAction(tx, actor, { entityType: "ApiKey", entityId: gone.id, action: "REVOKE", before: { name: gone.name, prefix: gone.prefix } });
  });
}

/** Find the live key behind an "Authorization: Bearer ..." header. */
export async function authenticateApiKey(header: string | null): Promise<ApiKey | null> {
  const match = header?.match(/^Bearer\s+(ct_[A-Za-z0-9_-]{20,64})$/);
  if (!match) return null;
  const digest = hashKey(match[1]);
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, digest), isNull(apiKeys.revokedAt)));
  if (!key || !timingSafeEqual(Buffer.from(key.keyHash), Buffer.from(digest))) return null;
  // Invite-only: keys made by businesses outside the list stop working too.
  if (!(await businessIsListed(key.orgId))) return null;
  // Record use at most once a minute to avoid a write on every call.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  }
  return key;
}

// ---------- Webhooks ----------

/** True for addresses inside a private network, this machine, or cloud metadata services. */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Check a webhook address before saving it: public https only. */
export function checkWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InventoryError("Enter a full web address starting with https://");
  }
  if (url.protocol !== "https:") throw new InventoryError("Webhook addresses must start with https:// so the data is encrypted on the way.");
  if (url.username || url.password) throw new InventoryError("Do not put a username or password in the address. Use the signing secret to verify requests instead.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (isIP(host) && isPrivateAddress(host))) {
    throw new InventoryError("Webhook addresses must be on the public internet, not a private network.");
  }
  return url;
}

export const WEBHOOK_EVENTS = [
  "PACKAGE_RECEIVED",
  "PACKAGE_ADJUSTED",
  "PACKAGE_MOVED",
  "PACKAGE_CREATED_FROM_PACKAGES",
  "PACKAGE_CREATED_FROM_HARVEST",
  "PACKAGE_DESTROYED",
  "LAB_RESULT_RECORDED",
  "HARVEST_CREATED",
  "HARVEST_FINISHED",
  "HARVEST_UNFINISHED",
  "TRANSFER_SHIPPED",
  "TRANSFER_DELIVERED",
  "RETAIL_SALE",
  "RETAIL_SALE_VOIDED",
  "RETAIL_SALE_RETURNED",
] as const;

export async function createWebhook(actor: Actor, input: { url: string; events: string[] }): Promise<{ secret: string }> {
  const url = checkWebhookUrl(input.url);
  const events = input.events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) throw new InventoryError("Tick at least one event to send.");
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(webhooks)
      .values({
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        url: url.toString(),
        secret,
        events,
        createdByName: actor.userName,
      })
      .returning({ id: webhooks.id });
    await logAdminAction(tx, actor, { entityType: "Webhook", entityId: made.id, action: "CREATE", after: { url: url.toString(), events } });
  });
  return { secret };
}

export async function setWebhookActive(actor: Actor, input: { webhookId: string; active: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const [changed] = await tx
      .update(webhooks)
      .set({ active: input.active })
      .where(and(eq(webhooks.id, input.webhookId), eq(webhooks.orgId, actor.orgId)))
      .returning({ id: webhooks.id, url: webhooks.url });
    if (changed) await logAdminAction(tx, actor, { entityType: "Webhook", entityId: changed.id, action: input.active ? "TURN_ON" : "TURN_OFF", after: { url: changed.url } });
  });
}

/** Queue a delivery to every active webhook at this facility that wants this event. Runs inside the change's transaction. */
export async function enqueueWebhooks(tx: Tx, facilityId: string, event: string, data: unknown): Promise<void> {
  const hooks = await tx
    .select({ id: webhooks.id, events: webhooks.events })
    .from(webhooks)
    .where(and(eq(webhooks.facilityId, facilityId), eq(webhooks.active, true)));
  const wanted = hooks.filter((h) => h.events.includes(event));
  if (wanted.length === 0) return;
  const payload = { event, createdAt: new Date().toISOString(), data };
  await tx.insert(webhookDeliveries).values(wanted.map((h) => ({ webhookId: h.id, event, payload })));
}

/** The signature header value: "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<body>'>". */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** For receivers: check a signature, refusing ones older than five minutes. */
export function verifySignature(secret: string, body: string, header: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const match = header.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
  if (!match) return false;
  const t = Number(match[1]);
  if (Math.abs(nowSeconds - t) > 300) return false;
  const expected = Buffer.from(signPayload(secret, body, t).split("v1=")[1], "hex");
  return timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}

type DeliveryOptions = { now?: Date; allowPrivate?: boolean; fetchImpl?: typeof fetch };

async function resolvesPublic(url: URL): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
}

async function deliverOne(hook: Webhook, delivery: { id: string; payload: unknown; attempts: number }, options: DeliveryOptions) {
  const now = options.now ?? new Date();
  const attempts = delivery.attempts + 1;
  const body = JSON.stringify({ id: delivery.id, ...(delivery.payload as object) });
  let response = "";
  let ok = false;
  let retryable = true;
  try {
    const url = new URL(hook.url);
    if (!options.allowPrivate && !(await resolvesPublic(url))) {
      response = "The address now points to a private network, so nothing was sent.";
      retryable = false;
    } else {
      const res = await (options.fetchImpl ?? fetch)(url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CannaTrace-Webhooks/1",
          "CannaTrace-Signature": signPayload(hook.secret, body, Math.floor(now.getTime() / 1000)),
          "CannaTrace-Delivery": delivery.id,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      ok = res.status >= 200 && res.status < 300;
      retryable = res.status === 429 || res.status >= 500;
      response = `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim();
    }
  } catch (error) {
    response = error instanceof Error ? error.message : "Connection failed";
  }
  const retryAt = !ok && retryable ? nextRetryAt(attempts, now) : null;
  await db
    .update(webhookDeliveries)
    .set({
      status: ok ? "DELIVERED" : retryAt ? "PENDING" : "FAILED",
      attempts,
      lastResponse: response.slice(0, 300),
      nextAttemptAt: retryAt ?? now,
      deliveredAt: ok ? now : null,
    })
    .where(eq(webhookDeliveries.id, delivery.id));
  return ok;
}

/** Send webhook deliveries that are due. Each is claimed with a row lock so two workers never send the same one. */
export async function processWebhooks(options: DeliveryOptions & { limit?: number } = {}): Promise<{ delivered: number; failed: number }> {
  const now = options.now ?? new Date();
  const result = { delivered: 0, failed: 0 };
  for (let i = 0; i < (options.limit ?? 100); i++) {
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ delivery: webhookDeliveries, hook: webhooks })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(and(eq(webhookDeliveries.status, "PENDING"), lte(webhookDeliveries.nextAttemptAt, now)))
        .orderBy(asc(webhookDeliveries.createdAt))
        .limit(1)
        .for("update", { of: webhookDeliveries, skipLocked: true });
      if (!row) return null;
      // Push it out of reach while it is being sent; the result overwrites this.
      await tx
        .update(webhookDeliveries)
        .set({ nextAttemptAt: sql`now() + interval '5 minutes'` })
        .where(eq(webhookDeliveries.id, row.delivery.id));
      return row;
    });
    if (!claimed) break;
    if (!claimed.hook.active) {
      await db.update(webhookDeliveries).set({ status: "FAILED", lastResponse: "Webhook was turned off." }).where(eq(webhookDeliveries.id, claimed.delivery.id));
      continue;
    }
    if (await deliverOne(claimed.hook, claimed.delivery, options)) result.delivered += 1;
    else result.failed += 1;
  }
  return result;
}
