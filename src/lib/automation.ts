import { and, count, desc, eq, gte } from "drizzle-orm";
import { automationActivity, automationControl, automationSettings } from "@/db/schema";
import { logAdminAction } from "./audit-log";
import { db } from "./db";
import { DEFAULT_CAP, decide, parseCap, parseKind, parseMode, type AutomationMode, type Decision } from "./automation-math";

type Actor = { userId: string; userName: string; orgId: string; facilityId: string };
const HOUR = 60 * 60 * 1000;

export async function getAutomation(orgId: string) {
  const [control] = await db.select().from(automationControl).where(eq(automationControl.orgId, orgId));
  const rows = await db.select().from(automationSettings).where(eq(automationSettings.orgId, orgId));
  return {
    paused: control?.paused ?? false,
    pausedBy: control?.pausedByName ?? null,
    pausedAt: control?.pausedAt ?? null,
    pauseReason: control?.reason ?? null,
    settings: new Map(rows.map((r) => [r.kind, { mode: r.mode as AutomationMode, hourlyCap: r.hourlyCap }])),
  };
}

export async function isAutomationPaused(orgId: string): Promise<boolean> {
  const [row] = await db.select({ paused: automationControl.paused }).from(automationControl).where(eq(automationControl.orgId, orgId));
  return row?.paused ?? false;
}

/** What an agent may do right now for this kind of work. Every agent asks this before it acts. */
export async function automationDecision(orgId: string, kind: string): Promise<Decision> {
  const state = await getAutomation(orgId);
  const setting = state.settings.get(kind);
  const [{ n }] = await db
    .select({ n: count() })
    .from(automationActivity)
    .where(and(eq(automationActivity.orgId, orgId), eq(automationActivity.kind, kind), eq(automationActivity.outcome, "DONE"), gte(automationActivity.createdAt, new Date(Date.now() - HOUR))));
  return decide({ kind, paused: state.paused, mode: setting?.mode, hourlyCap: setting?.hourlyCap ?? DEFAULT_CAP, doneLastHour: n });
}

export async function recordActivity(input: { orgId: string; facilityId?: string | null; kind: string; outcome: "DONE" | "PROPOSED" | "BLOCKED" | "FAILED"; summary: string; trigger?: string; requestedBy?: string }): Promise<void> {
  await db.insert(automationActivity).values({
    orgId: input.orgId,
    facilityId: input.facilityId ?? null,
    kind: input.kind,
    outcome: input.outcome,
    summary: input.summary.slice(0, 400),
    trigger: input.trigger?.slice(0, 200) ?? null,
    requestedBy: input.requestedBy?.slice(0, 100) ?? null,
  });
}

export async function recentActivity(orgId: string, limit = 60) {
  return db.select().from(automationActivity).where(eq(automationActivity.orgId, orgId)).orderBy(desc(automationActivity.createdAt)).limit(limit);
}

export async function setAutomationMode(actor: Actor, input: { kind: unknown; mode: unknown; hourlyCap: unknown }): Promise<void> {
  const kind = parseKind(input.kind);
  const mode = parseMode(input.mode);
  const hourlyCap = parseCap(input.hourlyCap);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(automationSettings).where(and(eq(automationSettings.orgId, actor.orgId), eq(automationSettings.kind, kind)));
    await tx
      .insert(automationSettings)
      .values({ orgId: actor.orgId, kind, mode, hourlyCap, updatedByName: actor.userName })
      .onConflictDoUpdate({ target: [automationSettings.orgId, automationSettings.kind], set: { mode, hourlyCap, updatedByName: actor.userName, updatedAt: new Date() } });
    await logAdminAction(tx, actor, { entityType: "Automation", entityId: kind, action: "SETTING_CHANGED", before: before ? { mode: before.mode, hourlyCap: before.hourlyCap } : null, after: { mode, hourlyCap } });
  });
}

export async function setAutomationPaused(actor: Actor, input: { paused: boolean; reason?: string }): Promise<void> {
  const reason = input.reason?.trim().slice(0, 200) || null;
  await db.transaction(async (tx) => {
    await tx
      .insert(automationControl)
      .values({ orgId: actor.orgId, paused: input.paused, pausedByName: input.paused ? actor.userName : null, pausedAt: input.paused ? new Date() : null, reason: input.paused ? reason : null })
      .onConflictDoUpdate({
        target: automationControl.orgId,
        set: { paused: input.paused, pausedByName: input.paused ? actor.userName : null, pausedAt: input.paused ? new Date() : null, reason: input.paused ? reason : null },
      });
    await logAdminAction(tx, actor, { entityType: "Automation", entityId: "ALL", action: input.paused ? "PAUSED" : "RESUMED", reason });
  });
}
