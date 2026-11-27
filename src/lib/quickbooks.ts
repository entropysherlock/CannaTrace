import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { customers, invoices, orders, payments, quickbooksConnections, quickbooksLinks } from "@/db/schema";
import { logAdminAction } from "./audit-log";
import { db } from "./db";
import { facilityZone } from "./time";
import { InventoryError } from "./inventory-math";
import { customerBody, displayName, invoiceBody, paymentBody, qbQuote } from "./quickbooks-map";
import { openSecret, sealSecret } from "./ai/secret-box";
import type { Session } from "./session";

/**
 * QuickBooks Online: one-click connect with Intuit's OAuth, then Leaf2Sale invoices and the payments
 * taken against them are copied into the books. It is one way (Leaf2Sale to QuickBooks) and idempotent:
 * every record that went over is remembered in quickbooks_links, so running it again sends only what is new.
 */

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR = "70";

export const quickbooksConfigured = () => Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
const sandbox = () => process.env.QUICKBOOKS_ENV === "sandbox";
const apiBase = () => (sandbox() ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");

export function redirectUri(origin: string): string {
  return process.env.QUICKBOOKS_REDIRECT_URI || `${origin}/api/quickbooks/callback`;
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

export function authorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QUICKBOOKS_CLIENT_ID ?? "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri(origin),
    state,
  });
  return `${AUTH_URL}?${params}`;
}

type TokenReply = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number };

async function tokenRequest(body: URLSearchParams): Promise<TokenReply> {
  const basic = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new TokenError(res.status);
  return (await res.json()) as TokenReply;
}

class TokenError extends Error {
  constructor(readonly status: number) {
    super(`Intuit refused the sign-in (${status}).`);
  }
}

const tokenRow = (orgId: string, t: TokenReply) => ({
  encryptedAccess: sealSecret(t.access_token, orgId),
  encryptedRefresh: sealSecret(t.refresh_token, orgId),
  accessExpiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000),
  refreshExpiresAt: new Date(Date.now() + t.x_refresh_token_expires_in * 1000),
});

/** Finish the connect: trade the one-time code for tokens and store them encrypted. */
export async function completeConnect(session: Session, input: { code: string; realmId: string; origin: string }): Promise<void> {
  if (!quickbooksConfigured()) throw new InventoryError("QuickBooks is not set up on this server yet.");
  if (!/^\d{5,20}$/.test(input.realmId)) throw new InventoryError("QuickBooks did not say which company to connect.");
  const tokens = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: redirectUri(input.origin) }));
  const row = { realmId: input.realmId, status: "CONNECTED", statusMessage: null, connectedByName: session.name, connectedAt: new Date(), ...tokenRow(session.orgId, tokens) };
  // A different company than before means the old links point at the wrong books.
  const [before] = await db.select({ realmId: quickbooksConnections.realmId }).from(quickbooksConnections).where(eq(quickbooksConnections.orgId, session.orgId));
  await db.transaction(async (tx) => {
    if (before && before.realmId !== input.realmId) await tx.delete(quickbooksLinks).where(eq(quickbooksLinks.orgId, session.orgId));
    await tx.insert(quickbooksConnections).values({ orgId: session.orgId, ...row }).onConflictDoUpdate({ target: quickbooksConnections.orgId, set: row });
    await logAdminAction(tx, { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }, { entityType: "Quickbooks", entityId: input.realmId, action: "CREATE", after: { connected: true } });
  });
  const name = await qb(session.orgId, "GET", `/companyinfo/${input.realmId}`).then((r) => (r as { CompanyInfo?: { CompanyName?: string } }).CompanyInfo?.CompanyName ?? null).catch(() => null);
  if (name) await db.update(quickbooksConnections).set({ companyName: name }).where(eq(quickbooksConnections.orgId, session.orgId));
}

export async function disconnectQuickbooks(session: Session): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(quickbooksLinks).where(eq(quickbooksLinks.orgId, session.orgId));
    const gone = await tx.delete(quickbooksConnections).where(eq(quickbooksConnections.orgId, session.orgId)).returning({ realmId: quickbooksConnections.realmId });
    if (gone[0]) await logAdminAction(tx, { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }, { entityType: "Quickbooks", entityId: gone[0].realmId, action: "DELETE", before: { connected: true } });
  });
}

export async function getQuickbooks(orgId: string) {
  const [c] = await db
    .select({
      companyName: quickbooksConnections.companyName,
      status: quickbooksConnections.status,
      statusMessage: quickbooksConnections.statusMessage,
      connectedByName: quickbooksConnections.connectedByName,
      connectedAt: quickbooksConnections.connectedAt,
      lastSyncAt: quickbooksConnections.lastSyncAt,
      lastSyncSummary: quickbooksConnections.lastSyncSummary,
    })
    .from(quickbooksConnections)
    .where(eq(quickbooksConnections.orgId, orgId));
  if (!c) return null;
  const pending = (await db.execute<{ invoices: number; payments: number }>(sql`
    select
      (select count(*)::int from invoices i where i.org_id = ${orgId}
         and not exists (select 1 from quickbooks_links l where l.org_id = ${orgId} and l.kind = 'invoice' and l.local_id = i.id)) as invoices,
      (select count(*)::int from payments p join invoices i on i.id = p.invoice_id where i.org_id = ${orgId}
         and not exists (select 1 from quickbooks_links l where l.org_id = ${orgId} and l.kind = 'payment' and l.local_id = p.id)) as payments`)).rows[0];
  return { ...c, pendingInvoices: pending?.invoices ?? 0, pendingPayments: pending?.payments ?? 0 };
}

// ---------- API calls ----------

/** A valid access token, refreshed (and the rotated refresh token saved) when it is near expiry. */
async function accessToken(orgId: string): Promise<{ token: string; realmId: string }> {
  const [c] = await db.select().from(quickbooksConnections).where(eq(quickbooksConnections.orgId, orgId));
  if (!c) throw new InventoryError("QuickBooks is not connected.");
  if (c.status !== "CONNECTED") throw new InventoryError("QuickBooks needs to be reconnected.");
  if (c.accessExpiresAt.getTime() > Date.now() + 30_000) return { token: openSecret(c.encryptedAccess, orgId), realmId: c.realmId };
  try {
    const t = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: openSecret(c.encryptedRefresh, orgId) }));
    await db.update(quickbooksConnections).set(tokenRow(orgId, t)).where(eq(quickbooksConnections.orgId, orgId));
    return { token: t.access_token, realmId: c.realmId };
  } catch (error) {
    if (error instanceof TokenError && (error.status === 400 || error.status === 401)) {
      await db.update(quickbooksConnections).set({ status: "NEEDS_RECONNECT", statusMessage: "QuickBooks no longer accepts this connection. Connect again." }).where(eq(quickbooksConnections.orgId, orgId));
      throw new InventoryError("QuickBooks no longer accepts this connection. Connect again.");
    }
    throw error;
  }
}

class QbError extends Error {}

/** One call to the QuickBooks API. Failures carry QuickBooks' own message, never the request or tokens. */
async function qb(orgId: string, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const { token, realmId } = await accessToken(orgId);
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${apiBase()}/v3/company/${realmId}${path}${sep}minorversion=${MINOR}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { Fault?: { Error?: { Message?: string; Detail?: string }[] } };
  if (!res.ok) {
    const e = json.Fault?.Error?.[0];
    throw new QbError(e ? `${e.Message ?? "QuickBooks refused it"}${e.Detail ? `: ${e.Detail}` : ""}`.slice(0, 300) : `QuickBooks answered ${res.status}.`);
  }
  return json;
}

const query = async <T>(orgId: string, q: string, key: string): Promise<T[]> =>
  (((await qb(orgId, "GET", `/query?query=${encodeURIComponent(q)}`)) as { QueryResponse?: Record<string, T[]> }).QueryResponse?.[key] ?? []);

async function linkOf(orgId: string, kind: string, localId: string): Promise<string | null> {
  const [l] = await db.select({ qbId: quickbooksLinks.qbId }).from(quickbooksLinks).where(and(eq(quickbooksLinks.orgId, orgId), eq(quickbooksLinks.kind, kind), eq(quickbooksLinks.localId, localId)));
  return l?.qbId ?? null;
}
const saveLink = (orgId: string, kind: string, localId: string, qbId: string) =>
  db.insert(quickbooksLinks).values({ orgId, kind, localId, qbId }).onConflictDoUpdate({ target: [quickbooksLinks.orgId, quickbooksLinks.kind, quickbooksLinks.localId], set: { qbId, syncedAt: new Date() } });

const ITEM_NAME = "Leaf2Sale wholesale sales";

/** The one service item every invoice line uses, made on first use against the company's first income account. */
async function salesItem(orgId: string): Promise<string> {
  const found = await query<{ Id: string }>(orgId, `select Id from Item where Name = ${qbQuote(ITEM_NAME)}`, "Item");
  if (found[0]) return found[0].Id;
  const accounts = await query<{ Id: string }>(orgId, "select Id from Account where AccountType = 'Income' and Active = true maxresults 1", "Account");
  if (!accounts[0]) throw new QbError("This QuickBooks company has no income account to post sales to.");
  const made = (await qb(orgId, "POST", "/item", { Name: ITEM_NAME, Type: "Service", IncomeAccountRef: { value: accounts[0].Id } })) as { Item: { Id: string } };
  return made.Item.Id;
}

async function customerQbId(orgId: string, c: typeof customers.$inferSelect): Promise<string> {
  const known = await linkOf(orgId, "customer", c.id);
  if (known) return known;
  const name = displayName(c.name);
  const existing = await query<{ Id: string }>(orgId, `select Id from Customer where DisplayName = ${qbQuote(name)}`, "Customer");
  let id = existing[0]?.Id;
  if (!id) {
    const made = (await qb(orgId, "POST", "/customer", customerBody(c))) as { Customer: { Id: string } };
    id = made.Customer.Id;
  }
  await saveLink(orgId, "customer", c.id, id);
  return id;
}

export type SyncResult = { invoices: number; payments: number; failed: number; firstError: string | null };

/** Send every invoice and payment that has not gone over yet. Oldest first, a bounded batch per run. */
export async function syncQuickbooks(orgId: string, limit = 60): Promise<SyncResult> {
  const result: SyncResult = { invoices: 0, payments: 0, failed: 0, firstError: null };
  const fail = (what: string, e: unknown) => {
    result.failed++;
    result.firstError ??= `${what}: ${e instanceof Error ? e.message : "unknown error"}`;
  };
  const item = await salesItem(orgId);

  const sent = await db.select({ localId: quickbooksLinks.localId }).from(quickbooksLinks).where(and(eq(quickbooksLinks.orgId, orgId), eq(quickbooksLinks.kind, "invoice")));
  const sentIds = new Set(sent.map((s) => s.localId));
  const rows = await db
    .select({ inv: invoices, customer: customers, orderNumber: orders.number })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(eq(invoices.orgId, orgId))
    .orderBy(invoices.createdAt);
  let budget = limit;
  for (const r of rows) {
    if (sentIds.has(r.inv.id) || budget <= 0) continue;
    budget--;
    try {
      const cust = await customerQbId(orgId, r.customer);
      const issuedOn = r.inv.createdAt.toLocaleDateString("en-CA", { timeZone: await facilityZone(r.inv.facilityId) });
      const made = (await qb(orgId, "POST", "/invoice", invoiceBody({ number: r.inv.number, total: r.inv.total, dueDate: r.inv.dueDate, issuedOn, orderNumber: r.orderNumber }, cust, item))) as { Invoice: { Id: string } };
      await saveLink(orgId, "invoice", r.inv.id, made.Invoice.Id);
      result.invoices++;
    } catch (e) {
      fail(`Invoice ${r.inv.number}`, e);
    }
  }

  const paid = await db
    .select({ pay: payments, invoiceId: invoices.id, number: invoices.number, customer: customers })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(eq(invoices.orgId, orgId))
    .orderBy(payments.createdAt);
  const doneP = new Set((await db.select({ localId: quickbooksLinks.localId }).from(quickbooksLinks).where(and(eq(quickbooksLinks.orgId, orgId), eq(quickbooksLinks.kind, "payment")))).map((s) => s.localId));
  budget = limit;
  for (const r of paid) {
    if (doneP.has(r.pay.id) || budget <= 0) continue;
    const invQb = await linkOf(orgId, "invoice", r.invoiceId);
    if (!invQb) continue; // its invoice has not gone over (yet); it is picked up next run
    budget--;
    try {
      const cust = await customerQbId(orgId, r.customer);
      const made = (await qb(orgId, "POST", "/payment", paymentBody({ amount: r.pay.amount, method: r.pay.method, reference: r.pay.reference, paidOn: r.pay.paidOn }, cust, invQb))) as { Payment: { Id: string } };
      await saveLink(orgId, "payment", r.pay.id, made.Payment.Id);
      result.payments++;
    } catch (e) {
      fail(`Payment on invoice ${r.number}`, e);
    }
  }

  const summary = `${result.invoices} invoice${result.invoices === 1 ? "" : "s"} and ${result.payments} payment${result.payments === 1 ? "" : "s"} sent${result.failed ? `, ${result.failed} failed (${result.firstError})` : ""}.`;
  await db.update(quickbooksConnections).set({ lastSyncAt: new Date(), lastSyncSummary: summary.slice(0, 500) }).where(eq(quickbooksConnections.orgId, orgId));
  return result;
}

/** The scheduled run: every connected business that is still in good standing. */
export async function syncAllQuickbooks(): Promise<{ businesses: number; invoices: number; payments: number; failed: number; firstError: string | null }> {
  const connected = await db.select({ orgId: quickbooksConnections.orgId }).from(quickbooksConnections).where(eq(quickbooksConnections.status, "CONNECTED"));
  const total = { businesses: connected.length, invoices: 0, payments: 0, failed: 0, firstError: null as string | null };
  for (const { orgId } of connected) {
    try {
      const r = await syncQuickbooks(orgId);
      total.invoices += r.invoices;
      total.payments += r.payments;
      total.failed += r.failed;
      total.firstError ??= r.firstError;
    } catch (e) {
      total.failed++;
      total.firstError ??= e instanceof Error ? e.message : "unknown error";
    }
  }
  return total;
}
