import { auditLogs } from "@/db/schema";
import type { Tx } from "./db";

/**
 * Write an audit entry without queuing a state-system record. For settings and administration changes
 * (state system, API keys, webhooks) made in modules that can't use inventory's audit() without an import
 * cycle. Never put a secret in `after`.
 */
export async function logAdminAction(
  tx: Pick<Tx, "insert">,
  actor: { orgId: string; facilityId: string | null; userId: string; userName: string },
  entry: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown; reason?: string | null },
): Promise<void> {
  await tx.insert(auditLogs).values({
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    userId: actor.userId,
    userName: actor.userName,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason?.trim() || null,
  });
}
