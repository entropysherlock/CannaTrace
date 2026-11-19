import "server-only";
import Decimal from "decimal.js";
import type { SyncEvent } from "@/db/schema";
import type { Adapter } from "@/lib/sync";
import type { SendResult } from "@/lib/sync-math";
import { readConfig, type Nms2sConfig } from "./config";
import { explainNms2sError, Nms2sError } from "./errors";
import { idempotencyKey, submitWrite } from "./ledger";
import type { Nms2sEnvironment, Nms2sTransport, WriteOperation } from "./types";

/**
 * Connects CannaTrace's existing state-sync queue (src/lib/sync.ts) to the NMS2S ledger.
 *
 * NOT ACTIVE: ADAPTERS.NMS2S in sync.ts is still the manual adapter. This bridge is used by the tests
 * with the unofficial simulator, and will be switched on only after the official transport passes UAT.
 *
 * Each sync event becomes exactly one ledger entry, keyed by the event id, so retries from the queue
 * reuse the same key. An unknown outcome blocks the facility's queue (non-retryable error) until a
 * lookup or a person settles it, which keeps records in order and prevents a duplicate write.
 */

type Snapshot = { tag?: string; quantity?: string; unit?: string; from?: unknown; run?: string };

/** Map a sync event to a CannaTrace write intent. Null means "not supported automatically yet". */
export function toWriteOperation(event: Pick<SyncEvent, "type" | "payload" | "createdAt">): WriteOperation | null {
  const payload = event.payload as { before?: Snapshot; after?: Snapshot; reason?: string | null };
  const after = payload.after ?? {};
  if (event.type === "PACKAGE_ADJUSTED" && after.tag && after.unit) {
    const before = payload.before ?? {};
    const [reason, ...note] = String(payload.reason ?? "").split(": ");
    return {
      kind: "PACKAGE_ADJUST",
      packageTag: after.tag,
      quantityChange: new Decimal(after.quantity ?? 0).sub(before.quantity ?? 0).toString(),
      newQuantity: new Decimal(after.quantity ?? 0).toString(),
      unit: after.unit,
      reason: reason || "Unspecified",
      note: note.join(": ") || null,
      occurredAt: event.createdAt.toISOString(),
    };
  }
  // The same event type also covers merges (from: list of tags) and production runs (run: name); only a
  // split names a single source package. Merges and production stay manual until the spec maps them.
  if (event.type === "PACKAGE_CREATED_FROM_PACKAGES" && after.tag && after.unit && typeof after.from === "string" && !("run" in after)) {
    return { kind: "PACKAGE_SPLIT", sourceTag: after.from, newTag: after.tag, quantity: new Decimal(after.quantity ?? 0).toString(), unit: after.unit, note: payload.reason ?? null, occurredAt: event.createdAt.toISOString() };
  }
  return null;
}

export function nms2sAdapter(transport: Nms2sTransport, environment: Nms2sEnvironment, options: { config?: Nms2sConfig; credentials?: Record<string, string> } = {}): Adapter {
  const config = options.config ?? readConfig();
  return {
    supported: ["PACKAGE_ADJUSTED", "PACKAGE_CREATED_FROM_PACKAGES"],
    status: () => ({ ready: transport.kind === "SIMULATOR" || Boolean(config.environment), note: transport.label }),
    async send(event): Promise<SendResult> {
      const op = toWriteOperation(event);
      if (!op) return { outcome: "MANUAL", detail: "CannaTrace can't send this kind of record to NMS2S yet. Enter it in NMS2S by hand." };
      const actor = { userId: "system:nms2s", userName: "NMS2S sync", orgId: event.orgId, facilityId: event.facilityId };
      try {
        const r = await submitWrite(actor, { transport, environment, config, credentials: options.credentials }, {
          op,
          idempotencyKey: idempotencyKey(event.facilityId, environment, `sync_event:${event.id}`),
          local: { entityType: event.entityType, entityId: event.entityId },
          syncEventId: event.id,
        });
        if (r.status === "ACCEPTED" || r.status === "RESOLVED_APPLIED") return { outcome: "SENT", externalId: r.stateReference ?? undefined };
        if (r.status === "RETRYABLE") {
          // Known not applied. Temporary problems retry on the queue's schedule; credential or permission
          // problems wait for a person to fix them and press Retry, so a bad key isn't hammered.
          const needsFix = r.errorKind === "AUTH_FAILED" || r.errorKind === "FORBIDDEN";
          return { outcome: "ERROR", code: r.errorKind === "AUTH_FAILED" ? "AUTH_FAILED" : r.errorKind === "FORBIDDEN" ? "FORBIDDEN" : "NETWORK", retryable: !needsFix, detail: r.detail };
        }
        if (r.status === "REJECTED") return { outcome: "ERROR", code: r.errorKind === "NOT_FOUND" ? "NOT_FOUND" : "REJECTED", retryable: false, detail: r.detail };
        // IN_FLIGHT elsewhere, or UNKNOWN_OUTCOME: hold the queue; never resend blindly.
        return { outcome: "ERROR", code: "UNKNOWN", retryable: false, detail: r.status === "IN_FLIGHT" ? r.detail : `${explainNms2sError("UNKNOWN_OUTCOME")} (request ${r.requestId.slice(0, 8)})` };
      } catch (e) {
        if (e instanceof Nms2sError) return { outcome: "ERROR", code: e.kind === "SPEC_PENDING" || e.kind === "TRAFFIC_DISABLED" || e.kind === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNKNOWN", retryable: false, detail: e.message };
        throw e;
      }
    },
  };
}
