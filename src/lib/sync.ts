import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { facilities, syncEvents, type SyncEvent } from "@/db/schema";
import { db, pool, type Tx } from "./db";
import { todayIn } from "./distribution-math";
import { enqueueWebhooks } from "./integrations";
import { InventoryError } from "./inventory-math";
import { DEFAULT_ZONE, facilityZone } from "./time";
import {
  SYSTEM_LABELS,
  classifyHttpStatus,
  describeEvent,
  eventTypeFor,
  nextRetryAt,
  type SendResult,
  type SystemName,
} from "./sync-math";

type Actor = { userId: string; userName: string; orgId: string; facilityId: string };
type Snapshot = Record<string, unknown> | null | undefined;

export type Adapter = {
  /** What this adapter can send automatically; everything else is marked "enter by hand". */
  supported: string[];
  /** Whether the keys it needs are present, and a note for the status page. */
  status(): { ready: boolean; note: string };
  send(event: SyncEvent, context: { licenseNumber: string }): Promise<SendResult>;
};

// ---------- Adapters ----------

const mockAdapter: Adapter = {
  supported: ["*"],
  status: () => ({ ready: true, note: "Practice mode. Records are marked as sent but nothing leaves CannaTrace." }),
  async send(event) {
    return { outcome: "SENT", externalId: `PRACTICE-${event.seq}` };
  },
};

const METRC_UNITS: Record<string, string> = {
  MG: "Milligrams",
  G: "Grams",
  KG: "Kilograms",
  OZ: "Ounces",
  LB: "Pounds",
  ML: "Milliliters",
  L: "Liters",
  EACH: "Each",
};

/** The Metrc request for an event, or null when CannaTrace does not send that kind of record to Metrc yet. */
export function metrcRequest(
  event: Pick<SyncEvent, "type" | "payload" | "createdAt">,
  /** The facility's time zone: Metrc wants the date the change happened there. */
  zone = DEFAULT_ZONE,
): { method: "POST"; path: string; body: unknown } | null {
  const payload = event.payload as { before?: Snapshot; after?: Snapshot; reason?: string | null };
  if (event.type === "PACKAGE_ADJUSTED") {
    const before = payload.before ?? {};
    const after = payload.after ?? {};
    const delta = Number(after.quantity) - Number(before.quantity);
    const [reason, ...note] = String(payload.reason ?? "").split(": ");
    return {
      method: "POST",
      path: "/packages/v2/adjust",
      body: [
        {
          Label: after.tag,
          Quantity: Number(delta.toFixed(4)),
          UnitOfMeasure: METRC_UNITS[String(after.unit)] ?? String(after.unit),
          AdjustmentReason: reason,
          AdjustmentDate: todayIn(zone, event.createdAt),
          ReasonNote: note.join(": ") || reason,
        },
      ],
    };
  }
  return null;
}

const metrcAdapter: Adapter = {
  supported: ["PACKAGE_ADJUSTED"],
  status() {
    const missing = ["METRC_API_URL", "METRC_VENDOR_KEY", "METRC_USER_KEY"].filter((key) => !process.env[key]);
    return missing.length
      ? { ready: false, note: `Not connected. Missing settings: ${missing.join(", ")}.` }
      : { ready: true, note: `Connected to ${process.env.METRC_API_URL}. Not yet tested against a live Metrc account.` };
  },
  async send(event, { licenseNumber }) {
    const base = process.env.METRC_API_URL;
    const vendorKey = process.env.METRC_VENDOR_KEY;
    const userKey = process.env.METRC_USER_KEY;
    if (!base || !vendorKey || !userKey) {
      return { outcome: "ERROR", code: "NOT_CONFIGURED", retryable: false, detail: "METRC_API_URL, METRC_VENDOR_KEY, or METRC_USER_KEY is not set." };
    }
    const request = metrcRequest(event, await facilityZone(event.facilityId));
    if (!request) return { outcome: "MANUAL", detail: "CannaTrace does not send this kind of record to Metrc yet. Enter it in Metrc by hand." };
    try {
      const response = await fetch(`${base.replace(/\/$/, "")}${request.path}?licenseNumber=${encodeURIComponent(licenseNumber)}`, {
        method: request.method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${vendorKey}:${userKey}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return { outcome: "SENT" };
      const { code, retryable } = classifyHttpStatus(response.status);
      const text = (await response.text().catch(() => "")).slice(0, 500);
      return { outcome: "ERROR", code, retryable, detail: `Metrc answered ${response.status}${text ? `: ${text}` : ""}` };
    } catch (error) {
      return { outcome: "ERROR", code: "NETWORK", retryable: true, detail: error instanceof Error ? error.message : "Connection failed" };
    }
  },
};

/** No automatic sending: every record is listed for someone to enter in the state system by hand. */
function manualAdapter(reason: string): Adapter {
  return {
    supported: [],
    status: () => ({ ready: true, note: reason }),
    async send() {
      return { outcome: "MANUAL", detail: reason };
    },
  };
}

export const ADAPTERS: Record<SystemName, Adapter> = {
  MOCK: mockAdapter,
  METRC: metrcAdapter,
  BIOTRACK: manualAdapter(
    "Automatic sending to BioTrack is not built. New Mexico stopped using BioTrack in September 2026. Enter these records in BioTrack by hand.",
  ),
  NMS2S: manualAdapter(
    "CannaTrace has asked New Mexico's Cannabis Control Division for NMS2S integrator access. Until the state approves it, enter these records in NMS2S by hand.",
  ),
};

// ---------- Queue ----------

/**
 * Called from the audit trail for every saved change. If the state needs to hear about it,
 * a record is queued in the same transaction, so it can never be lost or sent for an unsaved change.
 */
export async function enqueueSyncEvent(
  tx: Tx,
  actor: Actor,
  entry: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown; reason?: string | null },
): Promise<void> {
  const type = eventTypeFor(entry.entityType, entry.action);
  if (!type || !actor.facilityId) return;
  const [facility] = await tx.select({ system: facilities.trackTraceSystem }).from(facilities).where(eq(facilities.id, actor.facilityId));
  if (!facility) return;
  const before = (entry.before ?? null) as Snapshot;
  const after = (entry.after ?? null) as Snapshot;
  await enqueueWebhooks(tx, actor.facilityId, type, {
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: describeEvent(type, before, after),
    before,
    after,
    by: actor.userName,
  });
  await tx.insert(syncEvents).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    system: facility.system,
    type,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: describeEvent(type, before, after).slice(0, 300),
    payload: { before, after, reason: entry.reason ?? null, by: actor.userName },
  });
}

/** deferred: facilities (or the rest of one) left for the next run because this run reached its time budget. */
export type QueueResult = { sent: number; manual: number; failed: number; retrying: number; blocked: number; deferred: number };

/**
 * Send what is due, oldest first, one facility at a time. A record that fails stops the
 * records behind it at that facility, because the state usually needs them in order.
 * Records the system cannot take automatically are set aside for hand entry and do not block.
 */
export async function processQueue(
  options: { facilityId?: string; now?: Date; adapters?: Partial<Record<SystemName, Adapter>>; limit?: number; budgetMs?: number } = {},
): Promise<QueueResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;
  const adapters = { ...ADAPTERS, ...options.adapters };
  const result: QueueResult = { sent: 0, manual: 0, failed: 0, retrying: 0, blocked: 0, deferred: 0 };

  const due = await db
    .selectDistinct({ facilityId: syncEvents.facilityId })
    .from(syncEvents)
    .where(
      and(
        eq(syncEvents.status, "PENDING"),
        lte(syncEvents.nextAttemptAt, now),
        options.facilityId ? eq(syncEvents.facilityId, options.facilityId) : undefined,
      ),
    );

  // Stop starting new sends well before the request's time limit, so a run is never cut off mid-way.
  const deadline = Date.now() + (options.budgetMs ?? 40_000);
  for (const { facilityId } of due) {
    if (Date.now() > deadline) {
      result.deferred += 1;
      continue;
    }
    // Only one worker per facility at a time; another one already running simply skips it. The lock is
    // held on its own connection, and each record's new status is saved the moment it is sent, so a
    // run that stops part way never forgets what the state already accepted (and never sends it twice).
    const client = await pool.connect();
    const key = `sync:${facilityId}`;
    try {
      const locked = (await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [key])).rows[0].locked;
      if (!locked) continue;
      try {
        const [facility] = await db.select().from(facilities).where(eq(facilities.id, facilityId));
        for (let handled = 0; handled < limit; handled++) {
          if (Date.now() > deadline) {
            result.deferred += 1;
            break;
          }
          const [event] = await db
            .select()
            .from(syncEvents)
            .where(and(eq(syncEvents.facilityId, facilityId), inArray(syncEvents.status, ["PENDING", "FAILED"])))
            .orderBy(asc(syncEvents.seq))
            .limit(1);
          if (!event) break;
          if (event.status === "FAILED") {
            result.blocked += 1;
            break;
          }
          if (event.nextAttemptAt > now) break;

          const adapter = adapters[event.system];
          const attempts = event.attempts + 1;
          const outcome = await adapter.send(event, { licenseNumber: facility.licenseNumber });
          if (outcome.outcome === "SENT") {
            await db
              .update(syncEvents)
              .set({ status: "SENT", attempts, externalId: outcome.externalId ?? null, lastErrorCode: null, lastErrorDetail: null, finishedAt: now })
              .where(eq(syncEvents.id, event.id));
            result.sent += 1;
            continue;
          }
          if (outcome.outcome === "MANUAL") {
            await db
              .update(syncEvents)
              .set({ status: "MANUAL", attempts, lastErrorCode: null, lastErrorDetail: outcome.detail })
              .where(eq(syncEvents.id, event.id));
            result.manual += 1;
            continue;
          }
          const retryAt = outcome.retryable ? nextRetryAt(attempts, now) : null;
          await db
            .update(syncEvents)
            .set({
              status: retryAt ? "PENDING" : "FAILED",
              attempts,
              nextAttemptAt: retryAt ?? event.nextAttemptAt,
              lastErrorCode: outcome.code,
              lastErrorDetail: outcome.detail.slice(0, 1000),
            })
            .where(eq(syncEvents.id, event.id));
          if (retryAt) result.retrying += 1;
          else result.failed += 1;
          break;
        }
      } finally {
        await client.query("select pg_advisory_unlock(hashtext($1))", [key]);
      }
    } finally {
      client.release();
    }
  }
  return result;
}

async function lockEvent(tx: Tx, actor: Actor, eventId: string): Promise<SyncEvent> {
  const [event] = await tx
    .select()
    .from(syncEvents)
    .where(and(eq(syncEvents.id, eventId), eq(syncEvents.orgId, actor.orgId), eq(syncEvents.facilityId, actor.facilityId)))
    .for("update");
  if (!event) throw new InventoryError("That record was not found at this facility.");
  return event;
}

/** Put a failed record back in line to be sent again straight away. */
export async function retryEvent(actor: Actor, input: { eventId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const event = await lockEvent(tx, actor, input.eventId);
    if (event.status !== "FAILED" && event.status !== "MANUAL") throw new InventoryError("Only failed records can be retried.");
    const [facility] = await tx.select({ system: facilities.trackTraceSystem }).from(facilities).where(eq(facilities.id, actor.facilityId));
    await tx
      .update(syncEvents)
      .set({ status: "PENDING", system: facility.system, nextAttemptAt: new Date() })
      .where(eq(syncEvents.id, event.id));
  });
}

/** Record that someone entered this in the state system by hand (or that it was not needed). */
export async function resolveEvent(actor: Actor, input: { eventId: string; note: string }): Promise<void> {
  const note = input.note.trim().slice(0, 300);
  if (!note) throw new InventoryError("Say what was done, for example \"Entered in Metrc by hand\".");
  await db.transaction(async (tx) => {
    const event = await lockEvent(tx, actor, input.eventId);
    if (event.status !== "FAILED" && event.status !== "MANUAL") throw new InventoryError("Only records that need attention can be marked handled.");
    await tx
      .update(syncEvents)
      .set({ status: "RESOLVED", resolvedBy: actor.userName, resolvedNote: note, finishedAt: new Date() })
      .where(eq(syncEvents.id, event.id));
  });
}

/** Choose which state system this facility reports to. Applies to records saved from now on. */
export async function setFacilitySystem(actor: Actor, input: { system: string }): Promise<void> {
  if (!(input.system in SYSTEM_LABELS)) throw new InventoryError("Choose a state system.");
  await db
    .update(facilities)
    .set({ trackTraceSystem: input.system as SystemName })
    .where(and(eq(facilities.id, actor.facilityId), eq(facilities.orgId, actor.orgId)));
}
