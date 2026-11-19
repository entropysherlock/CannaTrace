import "server-only";
import { after } from "next/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { facilities, stateReports, watchFindings, watchSweeps, type WatchFinding } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import { can, type Permission } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { CHECKS, stateUnit, type Finding } from "./checks";
import { inFacilityZone } from "@/lib/time";

export type { Finding };
type Scope = { orgId: string; facilityId: string };

/** How old a sweep can be before opening Tally Watch runs a new one. */
export const FRESH_MINUTES = 15;
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as Record<string, number>;

/**
 * Run every check for one facility and bring the saved findings up to date: new ones open,
 * ones that came back reopen, ones that are gone resolve. Dismissed findings stay dismissed while
 * the problem is unchanged. A check that errors is skipped, never taken as "all clear".
 */
export async function sweepFacility(f: Scope): Promise<{ open: number; opened: number; resolved: number; failedChecks: string[] }> {
  // A sweep is as fresh as the moment its checks started reading: a change made while it runs must
  // trigger another look, so the sweep is stamped with its start, not its end.
  const startedAt = new Date();
  const found: Finding[] = [];
  const failedChecks: string[] = [];
  const failedKinds = new Set<string>();
  for (const check of CHECKS) {
    try {
      found.push(...(await inFacilityZone(f.facilityId, () => check.run(f))));
    } catch (error) {
      console.error("watch check failed", check.name, error);
      failedChecks.push(check.name);
      check.kinds.forEach((k) => failedKinds.add(k));
    }
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`watch:${f.facilityId}`}))`);
    // A sweep that started later has already saved fresher findings: don't overwrite them with older ones.
    const [newer] = await tx
      .select({ open: watchSweeps.open })
      .from(watchSweeps)
      .where(and(eq(watchSweeps.facilityId, f.facilityId), gt(watchSweeps.createdAt, startedAt)))
      .limit(1);
    if (newer) return { open: newer.open, opened: 0, resolved: 0, failedChecks };
    const existing = await tx.select().from(watchFindings).where(and(eq(watchFindings.orgId, f.orgId), eq(watchFindings.facilityId, f.facilityId)));
    const byKey = new Map(existing.map((e) => [e.key, e]));
    const now = new Date();
    let opened = 0;
    for (const x of found) {
      const was = byKey.get(x.key);
      const values = {
        check: x.check,
        severity: x.severity,
        title: x.title.slice(0, 300),
        detail: x.detail.slice(0, 1000),
        permission: x.permission,
        href: x.href ?? null,
        fix: x.fix ?? null,
        ask: x.ask ?? null,
        lastSeenAt: now,
      };
      if (!was) {
        await tx.insert(watchFindings).values({ orgId: f.orgId, facilityId: f.facilityId, key: x.key, ...values });
        opened++;
      } else {
        const reopen = was.status === "RESOLVED";
        await tx
          .update(watchFindings)
          .set({ ...values, ...(reopen ? { status: "OPEN", resolvedAt: null, firstSeenAt: now } : {}) })
          .where(eq(watchFindings.id, was.id));
        if (reopen) opened++;
      }
    }
    const current = new Set(found.map((x) => x.key));
    let resolved = 0;
    for (const e of existing) {
      if (current.has(e.key) || e.status === "RESOLVED") continue;
      // If its check couldn't run this time, we don't know it's fixed.
      if (failedKinds.has(e.check)) continue;
      await tx.update(watchFindings).set({ status: "RESOLVED", resolvedAt: now }).where(eq(watchFindings.id, e.id));
      resolved++;
    }
    const open = found.filter((x) => byKey.get(x.key)?.status !== "DISMISSED").length;
    await tx.insert(watchSweeps).values({ orgId: f.orgId, facilityId: f.facilityId, open, opened, resolved, createdAt: startedAt });
    return { open, opened, resolved, failedChecks };
  });
}

/**
 * Anything at this facility changed after `since`: any recorded change (every change writes the audit
 * log: holds, moves, lab results, Tally's fixes, undos), a label print, or a new state report. A fix
 * made anywhere then clears its finding on the next page load instead of waiting for a dismiss.
 */
async function changedSince(f: Scope, since: Date): Promise<boolean> {
  const at = since.toISOString();
  const result = await db.execute(sql`select
    exists (select 1 from audit_logs where org_id = ${f.orgId} and facility_id = ${f.facilityId} and created_at > ${at})
    or exists (select 1 from print_jobs where org_id = ${f.orgId} and facility_id = ${f.facilityId} and created_at > ${at})
    or exists (select 1 from state_reports where org_id = ${f.orgId} and facility_id = ${f.facilityId} and created_at > ${at}) as changed`);
  return Boolean((result.rows[0] as { changed: boolean } | undefined)?.changed);
}

/** Sweep if the last one is older than FRESH_MINUTES, or anything has changed at the facility since it ran. */
export async function sweepIfStale(f: Scope): Promise<void> {
  const [last] = await db
    .select({ at: watchSweeps.createdAt })
    .from(watchSweeps)
    .where(eq(watchSweeps.facilityId, f.facilityId))
    .orderBy(desc(watchSweeps.createdAt))
    .limit(1);
  if (last && Date.now() - last.at.getTime() < FRESH_MINUTES * 60_000 && !(await changedSince(f, last.at))) return;
  await sweepFacility(f);
}

/**
 * For pages: start the stale-check sweep but never hold the page longer than `waitMs` for it.
 * If it's still running, the page shows the last saved findings and the sweep finishes after
 * the response is sent (Next.js `after`), so the next visit has fresh findings.
 */
export async function sweepIfStaleBriefly(f: Scope, waitMs = 2500): Promise<void> {
  const sweeping = sweepIfStale(f).catch((error) => console.error("watch sweep failed", f.facilityId, error));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), waitMs);
  });
  const result = await Promise.race([sweeping.then(() => "done" as const), timedOut]);
  clearTimeout(timer);
  if (result === "timeout") after(() => sweeping);
}

/** Every facility, for the scheduled run. */
export async function sweepAll(): Promise<{ facilities: number; open: number; failed: number }> {
  const all = await db.select({ orgId: facilities.orgId, facilityId: facilities.id }).from(facilities);
  let open = 0;
  let failed = 0;
  for (const f of all) {
    try {
      open += (await sweepFacility(f)).open;
    } catch (error) {
      failed++;
      console.error("watch sweep failed", f.facilityId, error);
    }
  }
  return { facilities: all.length, open, failed };
}

const visible = (session: Session, f: WatchFinding) => !f.permission || can(session, f.permission as Permission);

/** Open findings this person may see, most serious first. */
export async function openFindings(session: Session): Promise<WatchFinding[]> {
  const list = await db
    .select()
    .from(watchFindings)
    .where(and(eq(watchFindings.orgId, session.orgId), eq(watchFindings.facilityId, session.facilityId), eq(watchFindings.status, "OPEN")));
  return list.filter((f) => visible(session, f)).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
}

export async function findingFor(session: Session, id: string): Promise<WatchFinding> {
  const [f] = await db
    .select()
    .from(watchFindings)
    .where(and(eq(watchFindings.id, id), eq(watchFindings.orgId, session.orgId), eq(watchFindings.facilityId, session.facilityId)));
  if (!f || !visible(session, f)) throw new InventoryError("That Tally Watch item was not found.");
  return f;
}

export async function dismissFinding(session: Session, id: string): Promise<void> {
  const f = await findingFor(session, id);
  await db.update(watchFindings).set({ status: "DISMISSED", dismissedByName: session.name }).where(eq(watchFindings.id, f.id));
}

export async function lastSweep(scope: Scope) {
  const [last] = await db.select().from(watchSweeps).where(eq(watchSweeps.facilityId, scope.facilityId)).orderBy(desc(watchSweeps.createdAt)).limit(1);
  return last ?? null;
}

// ---------- State package report upload ----------

export const MAX_REPORT_ROWS = 20_000;
const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, "");

/**
 * Read a package report exported from the state system. Column names vary by state and export,
 * so it looks for a tag column and, if present, quantity, unit, item, and status columns.
 * "Quantity" may hold "12.5 Grams"; the unit is split off.
 */
export function parseStateReport(text: string) {
  const table = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  if (table.length < 2) throw new InventoryError("The file has no package rows.");
  const header = table[0].map(norm);
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const tagCol = find("tag", "packagetag", "label", "packagelabel", "packageid", "uid");
  if (tagCol < 0) throw new InventoryError("Couldn't find a Tag column. Export the Packages list from the state system as a CSV and upload it as is.");
  const qtyCol = find("quantity", "qty", "currentquantity", "remainingquantity");
  const unitCol = find("uom", "unitofmeasure", "unit", "unitofmeasurename", "quantityunit");
  const itemCol = find("item", "itemname", "product", "productname");
  const statusCol = find("status", "packagestatus", "state");
  const rows = table.slice(1).map((r) => {
    const raw = qtyCol >= 0 ? (r[qtyCol] ?? "").trim() : "";
    const m = raw.replace(/,/g, "").match(/^(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/);
    const unit = (unitCol >= 0 ? (r[unitCol] ?? "").trim() : "") || m?.[2] || null;
    return {
      tag: (r[tagCol] ?? "").trim().toUpperCase(),
      quantity: m ? m[1] : null,
      unit: unit && stateUnit(unit) ? unit : unit,
      item: itemCol >= 0 ? (r[itemCol] ?? "").trim().slice(0, 200) || null : null,
      status: statusCol >= 0 ? (r[statusCol] ?? "").trim().slice(0, 40) || null : null,
    };
  });
  const clean = rows.filter((r) => r.tag);
  if (!clean.length) throw new InventoryError("The Tag column is empty.");
  if (clean.length > MAX_REPORT_ROWS) throw new InventoryError(`That report has ${clean.length} packages; the limit is ${MAX_REPORT_ROWS}.`);
  const dup = clean.find((r, i) => clean.findIndex((x) => x.tag === r.tag) !== i);
  if (dup) throw new InventoryError(`Tag ${dup.tag} appears twice in the report. Export it again without duplicates.`);
  return { rows: clean, hasQuantity: qtyCol >= 0 };
}

export async function saveStateReport(session: Session, input: { fileName: string; text: string }): Promise<{ packages: number }> {
  const { rows } = parseStateReport(input.text);
  await db.insert(stateReports).values({ orgId: session.orgId, facilityId: session.facilityId, fileName: input.fileName.slice(0, 200) || "report.csv", uploadedByName: session.name, rows });
  await sweepFacility(session);
  return { packages: rows.length };
}

export async function latestStateReport(scope: Scope) {
  const [r] = await db
    .select({ fileName: stateReports.fileName, uploadedByName: stateReports.uploadedByName, createdAt: stateReports.createdAt, count: sql<number>`jsonb_array_length(${stateReports.rows})::int` })
    .from(stateReports)
    .where(and(eq(stateReports.orgId, scope.orgId), eq(stateReports.facilityId, scope.facilityId)))
    .orderBy(desc(stateReports.createdAt))
    .limit(1);
  return r ?? null;
}
