import "server-only";
import { and, eq } from "drizzle-orm";
import { facilities, nms2sCredentials } from "@/db/schema";
import { openSecretFor, sealSecretFor } from "@/lib/ai/secret-box";
import { db } from "@/lib/db";
import { audit, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { readConfig, type Nms2sConfig } from "./config";
import { Nms2sError } from "./errors";
import { hint } from "./redact";
import type { Nms2sEnvironment } from "./types";

/**
 * NMS2S credentials, one set per facility and environment, sealed with AES-256-GCM. The sealed value
 * is bound to the business, facility, and environment, so it can't be copied to another row and opened.
 * Field names are not fixed: the official specification decides which credentials NMS2S issues.
 * Callers must check `compliance.manage` before saving and only ever pass the session's facility.
 */

const context = (orgId: string, facilityId: string, environment: Nms2sEnvironment) => `nms2s:${orgId}:${facilityId}:${environment}`;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

export async function saveCredentials(
  actor: Actor,
  input: { environment: Nms2sEnvironment; values: Record<string, string> },
  config: Nms2sConfig = readConfig(),
): Promise<{ fields: Record<string, string> }> {
  if (input.environment === "PRODUCTION" && !config.productionApproved)
    throw new InventoryError("Production NMS2S credentials can't be saved until production use is approved on this server.");
  const entries = Object.entries(input.values).map(([k, v]) => [k.trim(), String(v ?? "").trim()] as const);
  if (!entries.length || entries.length > 10) throw new InventoryError("Enter the credentials NMS2S issued for this facility.");
  for (const [k, v] of entries) {
    if (!FIELD.test(k)) throw new InventoryError(`"${k.slice(0, 40)}" isn't a valid credential name.`);
    if (!v || v.length > 4000) throw new InventoryError(`Enter a value for ${k}.`);
  }
  const [facility] = await db.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.id, actor.facilityId), eq(facilities.orgId, actor.orgId)));
  if (!facility) throw new InventoryError("Facility not found.");
  const sealed = sealSecretFor(JSON.stringify(Object.fromEntries(entries)), context(actor.orgId, actor.facilityId, input.environment));
  const fieldHints = Object.fromEntries(entries.map(([k, v]) => [k, hint(v)]));
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ fieldHints: nms2sCredentials.fieldHints })
      .from(nms2sCredentials)
      .where(and(eq(nms2sCredentials.facilityId, actor.facilityId), eq(nms2sCredentials.environment, input.environment)));
    await tx
      .insert(nms2sCredentials)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, environment: input.environment, sealed, fieldHints, savedByName: actor.userName })
      .onConflictDoUpdate({ target: [nms2sCredentials.facilityId, nms2sCredentials.environment], set: { sealed, fieldHints, savedByName: actor.userName, savedAt: new Date() } });
    // The audit entry names the fields and their hints, never the values.
    await audit(tx, actor, {
      entityType: "Nms2sCredential",
      entityId: `${actor.facilityId}:${input.environment}`,
      action: before ? "ROTATE" : "SAVE",
      before: before ? { fields: before.fieldHints } : null,
      after: { environment: input.environment, fields: fieldHints },
    });
  });
  return { fields: fieldHints };
}

export async function removeCredentials(actor: Actor, environment: Nms2sEnvironment): Promise<void> {
  await db.transaction(async (tx) => {
    const gone = await tx
      .delete(nms2sCredentials)
      .where(and(eq(nms2sCredentials.orgId, actor.orgId), eq(nms2sCredentials.facilityId, actor.facilityId), eq(nms2sCredentials.environment, environment)))
      .returning({ fieldHints: nms2sCredentials.fieldHints });
    if (gone.length) await audit(tx, actor, { entityType: "Nms2sCredential", entityId: `${actor.facilityId}:${environment}`, action: "REMOVE", before: { fields: gone[0].fieldHints } });
  });
}

/** What may be shown: which fields are saved and their hints. */
export async function credentialStatus(scope: { orgId: string; facilityId: string }, environment: Nms2sEnvironment) {
  const [row] = await db
    .select({ fieldHints: nms2sCredentials.fieldHints, savedByName: nms2sCredentials.savedByName, savedAt: nms2sCredentials.savedAt })
    .from(nms2sCredentials)
    .where(and(eq(nms2sCredentials.orgId, scope.orgId), eq(nms2sCredentials.facilityId, scope.facilityId), eq(nms2sCredentials.environment, environment)));
  return row ?? null;
}

/** Server-side only: the decrypted values, for the transport. Never return these to a page or a log. */
export async function loadCredentials(scope: { orgId: string; facilityId: string }, environment: Nms2sEnvironment): Promise<Record<string, string>> {
  const [row] = await db
    .select({ sealed: nms2sCredentials.sealed })
    .from(nms2sCredentials)
    .where(and(eq(nms2sCredentials.orgId, scope.orgId), eq(nms2sCredentials.facilityId, scope.facilityId), eq(nms2sCredentials.environment, environment)));
  if (!row) throw new Nms2sError("NOT_CONFIGURED", `No ${environment} NMS2S credentials are saved for this facility.`);
  try {
    return JSON.parse(openSecretFor(row.sealed, context(scope.orgId, scope.facilityId, environment)));
  } catch {
    throw new Nms2sError("NOT_CONFIGURED", "The saved NMS2S credentials can't be opened on this server. Save them again.");
  }
}
