import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { facilities, nms2sIdMap, nms2sReconciliations, nms2sRequests, packages, plants } from "@/db/schema";
import { db } from "@/lib/db";
import { audit, type Actor } from "@/lib/inventory";
import type { UnitCode } from "@/lib/units";
import { assertCallAllowed, readConfig, type Nms2sConfig } from "./config";
import { loadCredentials } from "./credentials";
import { Nms2sError, readRetry, toNms2sError } from "./errors";
import { UNSETTLED } from "./ledger";
import { reconcile, type ReconcileReport, type StatusMap } from "./reconcile";
import type { CallContext, Nms2sEnvironment, Nms2sTransport, Page, PageRequest } from "./types";

/** Hard ceiling on pages read in one run, so a looping cursor can't run forever. */
export const MAX_PAGES = 2000;
export const PAGE_SIZE = 200;

/** Read every page, retrying a page a few times when the error is temporary. Reads never change state data. */
export async function readAll<T>(fetchPage: (page: PageRequest) => Promise<Page<T>>, options: { pageSize?: number; attempts?: number } = {}): Promise<T[]> {
  const out: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    let page: Page<T> | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        page = await fetchPage({ cursor, pageSize: options.pageSize ?? PAGE_SIZE });
        break;
      } catch (e) {
        const err = toNms2sError(e);
        if (readRetry(err.kind) !== "AUTOMATIC" || attempt >= (options.attempts ?? 3)) throw err;
      }
    }
    out.push(...page.records);
    if (!page.nextCursor) return out;
    if (cursors.has(page.nextCursor)) throw new Nms2sError("MALFORMED", "The state system returned the same page cursor twice.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Nms2sError("MALFORMED", `Stopped after ${MAX_PAGES} pages.`);
}

/**
 * Compare this facility with the state system and save the findings. Read-only on both sides:
 * no inventory, plant, or state record is changed. The saved run can't be edited or deleted.
 */
export async function runReconciliation(
  actor: Actor,
  deps: { transport: Nms2sTransport; environment: Nms2sEnvironment; config?: Nms2sConfig; credentials?: Record<string, string>; statusMap?: StatusMap },
): Promise<{ id: string; report: ReconcileReport; transport: string }> {
  assertCallAllowed(deps.config ?? readConfig(), deps.environment, deps.transport.kind);
  const [facility] = await db.select({ licenseNumber: facilities.licenseNumber }).from(facilities).where(and(eq(facilities.id, actor.facilityId), eq(facilities.orgId, actor.orgId)));
  if (!facility) throw new Nms2sError("NOT_CONFIGURED", "Facility not found.");
  const ctx: CallContext = { environment: deps.environment, facilityId: actor.facilityId, licenseNumber: facility.licenseNumber, credentials: deps.credentials ?? (await loadCredentials(actor, deps.environment)) };

  const statePackages = await readAll((p) => deps.transport.listPackages(ctx, p));
  const statePlants = await readAll((p) => deps.transport.listPlants(ctx, p));

  const scope = and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId));
  const localPackages = await db.select({ id: packages.id, tag: packages.tag, quantity: packages.quantity, unit: packages.unit, status: packages.status }).from(packages).where(scope);
  const localPlants = await db.select({ id: plants.id, tag: plants.tag, status: plants.status }).from(plants).where(and(eq(plants.orgId, actor.orgId), eq(plants.facilityId, actor.facilityId)));
  const pendingRows = await db
    .select({ localEntityType: nms2sRequests.localEntityType, localEntityId: nms2sRequests.localEntityId, status: nms2sRequests.status, operation: nms2sRequests.operation })
    .from(nms2sRequests)
    .where(and(eq(nms2sRequests.orgId, actor.orgId), eq(nms2sRequests.facilityId, actor.facilityId), eq(nms2sRequests.environment, deps.environment), inArray(nms2sRequests.status, UNSETTLED)));
  const tagOf = new Map<string, string>([...localPackages.map((p) => [`Package:${p.id}`, p.tag] as const), ...localPlants.map((p) => [`Plant:${p.id}`, p.tag] as const)]);
  const links = await db
    .select({ entityType: nms2sIdMap.entityType, localId: nms2sIdMap.localId, stateId: nms2sIdMap.stateId })
    .from(nms2sIdMap)
    .where(and(eq(nms2sIdMap.orgId, actor.orgId), eq(nms2sIdMap.facilityId, actor.facilityId), eq(nms2sIdMap.environment, deps.environment)));

  const report = reconcile({
    licenseNumber: facility.licenseNumber,
    local: [
      ...localPackages.map((p) => ({ entityType: "Package" as const, localId: p.id, tag: p.tag, licenseNumber: facility.licenseNumber, quantity: String(p.quantity), unit: p.unit as UnitCode, status: p.status })),
      ...localPlants.map((p) => ({ entityType: "Plant" as const, localId: p.id, tag: p.tag, licenseNumber: facility.licenseNumber, quantity: null, unit: null, status: p.status })),
    ],
    statePackages,
    statePlants,
    pending: pendingRows.map((r) => ({ ...r, tag: tagOf.get(`${r.localEntityType}:${r.localEntityId}`) ?? null })),
    links,
    statusMap: deps.statusMap,
  });

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(nms2sReconciliations)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, environment: deps.environment, transport: deps.transport.kind, startedByName: actor.userName, counts: report.counts, findings: report.findings.filter((f) => f.kind !== "MATCH") })
      .returning({ id: nms2sReconciliations.id });
    await audit(tx, actor, { entityType: "Nms2sReconciliation", entityId: row.id, action: "RUN", after: { environment: deps.environment, transport: deps.transport.kind, counts: report.counts } });
    return row.id;
  });
  return { id, report, transport: deps.transport.label };
}

export async function latestReconciliation(scope: { orgId: string; facilityId: string }) {
  const [row] = await db
    .select()
    .from(nms2sReconciliations)
    .where(and(eq(nms2sReconciliations.orgId, scope.orgId), eq(nms2sReconciliations.facilityId, scope.facilityId)))
    .orderBy(desc(nms2sReconciliations.createdAt))
    .limit(1);
  return row ?? null;
}
