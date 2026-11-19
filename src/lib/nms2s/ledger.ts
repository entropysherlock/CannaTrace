import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { facilities, nms2sIdMap, nms2sRequests, packages, plants, type Nms2sRequest } from "@/db/schema";
import { db } from "@/lib/db";
import { audit, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { assertCallAllowed, readConfig, type Nms2sConfig } from "./config";
import { loadCredentials } from "./credentials";
import { DEFAULT_NOT_APPLIED, explainNms2sError, Nms2sError, toNms2sError, writeRetry, type Nms2sErrorKind } from "./errors";
import { redact, scrub } from "./redact";
import type { CallContext, Nms2sEnvironment, Nms2sTransport, WriteOperation } from "./types";

/**
 * Every write to NMS2S goes through this ledger:
 *
 *   1. A row is created for the idempotency key (derived from the local record that caused the write).
 *      The same key with a different payload is refused: it would mean two different writes claim
 *      to be the same one.
 *   2. The row is claimed atomically (PREPARED or RETRYABLE -> IN_FLIGHT). A second worker finds it
 *      claimed and does nothing, so two workers can't send the same write.
 *   3. The answer decides the next status. Only outcomes known not to be applied become RETRYABLE.
 *      A lost answer becomes UNKNOWN_OUTCOME, and nothing is sent for that key again until a lookup
 *      or a person settles whether the state applied it.
 *
 * Every transition is written to the audit log with credentials scrubbed.
 */

export type LedgerStatus = "PREPARED" | "IN_FLIGHT" | "ACCEPTED" | "REJECTED" | "RETRYABLE" | "UNKNOWN_OUTCOME" | "RESOLVED_APPLIED" | "RESOLVED_NOT_APPLIED";
export const DONE: LedgerStatus[] = ["ACCEPTED", "RESOLVED_APPLIED"];
export const UNSETTLED: LedgerStatus[] = ["PREPARED", "IN_FLIGHT", "RETRYABLE", "UNKNOWN_OUTCOME"];
const LEASE_MS = 2 * 60_000;

export type SubmitOutcome = {
  requestId: string;
  status: LedgerStatus;
  /** True when this call actually sent something to the transport. */
  sent: boolean;
  stateReference: string | null;
  errorKind: Nms2sErrorKind | null;
  detail: string;
};

export type Deps = { transport: Nms2sTransport; environment: Nms2sEnvironment; config?: Nms2sConfig; credentials?: Record<string, string> };

export function requestHash(op: WriteOperation): string {
  return createHash("sha256").update(canonical(op)).digest("hex");
}

/** Stable key for a write caused by a local record (for example a sync_events row). */
export function idempotencyKey(facilityId: string, environment: Nms2sEnvironment, source: string): string {
  return `ct-${createHash("sha256").update(`${facilityId}|${environment}|${source}`).digest("hex").slice(0, 40)}`;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

async function context(actor: Actor, deps: Deps, signal?: AbortSignal): Promise<CallContext> {
  const [facility] = await db
    .select({ licenseNumber: facilities.licenseNumber })
    .from(facilities)
    .where(and(eq(facilities.id, actor.facilityId), eq(facilities.orgId, actor.orgId)));
  if (!facility) throw new Nms2sError("NOT_CONFIGURED", "Facility not found.");
  const credentials = deps.credentials ?? (await loadCredentials(actor, deps.environment));
  return { environment: deps.environment, facilityId: actor.facilityId, licenseNumber: facility.licenseNumber, credentials, signal };
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function submitWrite(
  actor: Actor,
  deps: Deps,
  input: { op: WriteOperation; idempotencyKey: string; local: { entityType: string; entityId: string }; syncEventId?: string | null },
): Promise<SubmitOutcome> {
  const config = deps.config ?? readConfig();
  assertCallAllowed(config, deps.environment, deps.transport.kind);
  const hash = requestHash(input.op);

  await db
    .insert(nms2sRequests)
    .values({
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      environment: deps.environment,
      transport: deps.transport.kind,
      operation: input.op.kind,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      localEntityType: input.local.entityType,
      localEntityId: input.local.entityId,
      syncEventId: input.syncEventId ?? null,
    })
    .onConflictDoNothing();
  await expireLeases(actor);
  const [row] = await db
    .select()
    .from(nms2sRequests)
    .where(and(eq(nms2sRequests.orgId, actor.orgId), eq(nms2sRequests.facilityId, actor.facilityId), eq(nms2sRequests.environment, deps.environment), eq(nms2sRequests.idempotencyKey, input.idempotencyKey)));
  if (!row) throw new InventoryError("The request ledger entry could not be found.");
  if (row.requestHash !== hash) throw new InventoryError("A different write already used this request key. Nothing was sent.");
  if (row.transport !== deps.transport.kind) throw new InventoryError(`This write was started against ${row.transport}; it can't be finished against ${deps.transport.kind}.`);
  if (!["PREPARED", "RETRYABLE"].includes(row.status)) return outcomeOf(row, false);

  // Claim it. Only one caller can move it to IN_FLIGHT.
  const [claimed] = await db
    .update(nms2sRequests)
    .set({ status: "IN_FLIGHT", attempts: sql`${nms2sRequests.attempts} + 1`, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
    .where(and(eq(nms2sRequests.id, row.id), inArray(nms2sRequests.status, ["PREPARED", "RETRYABLE"])))
    .returning();
  if (!claimed) {
    const [now] = await db.select().from(nms2sRequests).where(eq(nms2sRequests.id, row.id));
    return outcomeOf(now, false);
  }

  let ctx: CallContext | null = null;
  try {
    const result = await withTimeout(config.timeoutMs, async (signal) => {
      ctx = await context(actor, deps, signal);
      return deps.transport.submit(ctx, input.op, input.idempotencyKey);
    });
    if (result.outcome === "DUPLICATE" && deps.transport.capabilities().idempotencyKeys !== "SUPPORTED") {
      // Without a documented idempotency guarantee, "duplicate" doesn't prove this exact write was applied.
      return await finish(actor, claimed, "UNKNOWN_OUTCOME", { errorKind: "UNKNOWN_OUTCOME", detail: `The state called this a duplicate: ${result.detail}` }, ctx);
    }
    if (result.outcome === "ACCEPTED") await linkIds(actor, deps.environment, result.stateIds ?? []);
    return await finish(actor, claimed, "ACCEPTED", { stateReference: result.stateReference, detail: result.outcome === "DUPLICATE" ? "Already applied (same request key)." : "Accepted." }, ctx);
  } catch (e) {
    const err = toNms2sError(e);
    const retry = writeRetry(err.kind, DEFAULT_NOT_APPLIED);
    const status: LedgerStatus = retry === "RECONCILE_FIRST" ? "UNKNOWN_OUTCOME" : retry === "AUTOMATIC" || retry === "AFTER_FIX" ? "RETRYABLE" : "REJECTED";
    return await finish(actor, claimed, status, { errorKind: err.kind, detail: err.message }, ctx);
  }
}

async function finish(
  actor: Actor,
  row: Nms2sRequest,
  status: LedgerStatus,
  info: { stateReference?: string | null; errorKind?: Nms2sErrorKind; detail: string },
  ctx: CallContext | null,
): Promise<SubmitOutcome> {
  const secrets = ctx ? Object.values((ctx as CallContext).credentials) : [];
  const detail = scrub(info.detail, secrets);
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(nms2sRequests)
      .set({
        status,
        leaseUntil: null,
        stateReference: info.stateReference ?? row.stateReference,
        lastErrorKind: info.errorKind ?? null,
        lastErrorDetail: info.errorKind ? detail : null,
        updatedAt: new Date(),
      })
      .where(and(eq(nms2sRequests.id, row.id), eq(nms2sRequests.status, "IN_FLIGHT")))
      .returning();
    await audit(tx, actor, {
      entityType: "Nms2sRequest",
      entityId: row.id,
      action: `WRITE_${status}`,
      after: redact({ operation: row.operation, idempotencyKey: row.idempotencyKey, environment: row.environment, transport: row.transport, attempt: row.attempts, stateReference: info.stateReference ?? null, errorKind: info.errorKind ?? null, detail }, secrets),
    });
    return u;
  });
  return outcomeOf(updated ?? { ...row, status }, true, info.errorKind ?? null, detail);
}

function outcomeOf(row: Nms2sRequest, sent: boolean, errorKind: Nms2sErrorKind | null = (row.lastErrorKind as Nms2sErrorKind) ?? null, detail?: string): SubmitOutcome {
  const status = row.status as LedgerStatus;
  const text =
    detail ??
    (status === "UNKNOWN_OUTCOME"
      ? explainNms2sError("UNKNOWN_OUTCOME")
      : status === "IN_FLIGHT"
        ? "Another worker is sending this now."
        : DONE.includes(status)
          ? "Already reported."
          : (row.lastErrorDetail ?? status));
  return { requestId: row.id, status, sent, stateReference: row.stateReference, errorKind, detail: text };
}

/** A worker that died mid-call leaves IN_FLIGHT behind. After the lease, nobody knows whether it was applied. */
export async function expireLeases(scope: { orgId: string; facilityId: string }, now = new Date()): Promise<number> {
  const stale = await db
    .update(nms2sRequests)
    .set({ status: "UNKNOWN_OUTCOME", leaseUntil: null, lastErrorKind: "UNKNOWN_OUTCOME", lastErrorDetail: "The sending worker stopped before an answer was recorded.", updatedAt: now })
    .where(and(eq(nms2sRequests.orgId, scope.orgId), eq(nms2sRequests.facilityId, scope.facilityId), eq(nms2sRequests.status, "IN_FLIGHT"), lt(nms2sRequests.leaseUntil, now)))
    .returning({ id: nms2sRequests.id });
  return stale.length;
}

/**
 * Try to settle an UNKNOWN_OUTCOME by asking the state, when the transport supports a lookup.
 * APPLIED -> RESOLVED_APPLIED. NOT_APPLIED -> RETRYABLE (it may be sent again). Anything else stays unknown.
 */
export async function lookupOutcome(actor: Actor, deps: Deps, requestId: string, op: WriteOperation): Promise<SubmitOutcome> {
  const config = deps.config ?? readConfig();
  assertCallAllowed(config, deps.environment, deps.transport.kind);
  const row = await mine(actor, requestId);
  if (row.status !== "UNKNOWN_OUTCOME") return outcomeOf(row, false);
  if (row.requestHash !== requestHash(op)) throw new InventoryError("That isn't the write this request recorded.");
  if (deps.transport.capabilities().lookupByClientReference !== "SUPPORTED") return outcomeOf(row, false, "UNKNOWN_OUTCOME", "The state system can't be asked about this write. Check it in NMS2S and record the answer by hand.");
  const ctx = await context(actor, deps);
  let found;
  try {
    found = await withTimeout(config.timeoutMs, (signal) => deps.transport.lookup({ ...ctx, signal }, op, row.idempotencyKey));
  } catch (e) {
    return outcomeOf(row, false, toNms2sError(e).kind, scrub(toNms2sError(e).message, Object.values(ctx.credentials)));
  }
  if (found.found === "UNKNOWN") return outcomeOf(row, false, "UNKNOWN_OUTCOME", found.detail);
  return settle(actor, row, found.found === "APPLIED" ? "RESOLVED_APPLIED" : "RESOLVED_NOT_APPLIED", {
    by: "lookup",
    note: found.found === "APPLIED" ? "The state confirmed it was applied." : "The state confirmed it was not applied.",
    stateReference: found.found === "APPLIED" ? found.stateReference : null,
  });
}

/** A person checked NMS2S and records whether the write is there. A note is required. */
export async function resolveByPerson(actor: Actor, requestId: string, input: { applied: boolean; note: string; stateReference?: string | null }): Promise<SubmitOutcome> {
  if (!input.note?.trim()) throw new InventoryError("Say what you checked in NMS2S.");
  const row = await mine(actor, requestId);
  if (!["UNKNOWN_OUTCOME", "RETRYABLE"].includes(row.status)) throw new InventoryError(`This request is ${row.status.toLowerCase().replace(/_/g, " ")}; there is nothing to resolve.`);
  return settle(actor, row, input.applied ? "RESOLVED_APPLIED" : "RESOLVED_NOT_APPLIED", { by: "person", note: input.note.trim().slice(0, 1000), stateReference: input.stateReference?.trim() || null });
}

async function settle(actor: Actor, row: Nms2sRequest, status: "RESOLVED_APPLIED" | "RESOLVED_NOT_APPLIED", info: { by: string; note: string; stateReference: string | null }) {
  // A write confirmed not applied goes back to RETRYABLE so it can be sent once more under the same key.
  const next = status === "RESOLVED_NOT_APPLIED" ? "RETRYABLE" : status;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(nms2sRequests)
      .set({ status: next, resolvedByName: actor.userName, resolvedNote: info.note, stateReference: info.stateReference ?? row.stateReference, updatedAt: new Date() })
      .where(and(eq(nms2sRequests.id, row.id), eq(nms2sRequests.status, row.status)))
      .returning();
    if (!u) throw new InventoryError("Someone else just changed this request. Reload and try again.");
    await audit(tx, actor, { entityType: "Nms2sRequest", entityId: row.id, action: status, before: { status: row.status }, after: { status: next, by: info.by, stateReference: info.stateReference }, reason: info.note });
    return u;
  });
  return outcomeOf(updated, false, null, info.note);
}

async function mine(actor: Actor, requestId: string): Promise<Nms2sRequest> {
  const [row] = await db.select().from(nms2sRequests).where(and(eq(nms2sRequests.id, requestId), eq(nms2sRequests.orgId, actor.orgId), eq(nms2sRequests.facilityId, actor.facilityId)));
  if (!row) throw new InventoryError("Request not found.");
  return row;
}

/** Record state ids returned by an accepted write. Only for records in this facility, matched by tag. */
async function linkIds(actor: Actor, environment: Nms2sEnvironment, ids: { entityType: "Package" | "Plant"; localTag: string; stateId: string }[]) {
  for (const id of ids) {
    const table = id.entityType === "Package" ? packages : plants;
    const [local] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.orgId, actor.orgId), eq(table.facilityId, actor.facilityId), eq(table.tag, id.localTag)));
    if (!local) continue;
    await db
      .insert(nms2sIdMap)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, environment, entityType: id.entityType, localId: local.id, stateId: id.stateId, source: "WRITE_RESPONSE", confirmedByName: actor.userName })
      .onConflictDoNothing();
  }
}

/** A person confirms that a CannaTrace record and a state id are the same thing (for example from a reconciliation proposal). */
export async function confirmLink(actor: Actor, input: { environment: Nms2sEnvironment; entityType: "Package" | "Plant"; localId: string; stateId: string }) {
  const table = input.entityType === "Package" ? packages : plants;
  const [local] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, input.localId), eq(table.orgId, actor.orgId), eq(table.facilityId, actor.facilityId)));
  if (!local) throw new InventoryError("That record isn't in this facility.");
  await db.transaction(async (tx) => {
    const made = await tx
      .insert(nms2sIdMap)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, environment: input.environment, entityType: input.entityType, localId: input.localId, stateId: input.stateId.trim(), source: "CONFIRMED_BY_PERSON", confirmedByName: actor.userName })
      .onConflictDoNothing()
      .returning({ id: nms2sIdMap.id });
    if (!made.length) throw new InventoryError("One of these is already linked to something else. Check the existing link first.");
    await audit(tx, actor, { entityType: "Nms2sIdLink", entityId: made[0].id, action: "CONFIRM", after: input });
  });
}
