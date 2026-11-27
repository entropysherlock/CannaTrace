import "server-only";
import { and, desc, eq, min } from "drizzle-orm";
import vercel from "../../vercel.json";
import { facilities, jobRuns, syncEvents, type JobRun } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * The scheduled jobs, their real schedules (read from vercel.json, so the app can never claim a schedule
 * that isn't set up), and a record of every run: when it ran, whether it worked, and what it did.
 */

export type JobName = "sync" | "watch" | "brief" | "quickbooks";

const PATHS: Record<JobName, string> = { sync: "/api/sync/run", watch: "/api/watch/run", brief: "/api/brief/run", quickbooks: "/api/quickbooks/run" };
export const JOB_LABEL: Record<JobName, string> = { sync: "State reporting and webhooks", watch: "Tally Watch check", brief: "Morning brief emails", quickbooks: "QuickBooks sync" };

/** The cron line for a job, or null when it isn't scheduled at all. */
export function cronFor(job: JobName): string | null {
  const crons = (vercel as { crons?: { path: string; schedule: string }[] }).crons ?? [];
  return crons.find((c) => c.path === PATHS[job])?.schedule ?? null;
}

/** How often a job is meant to run, in hours, for the "hasn't run on time" warning. Daily jobs get a little slack. */
export function expectedEveryHours(cron: string | null): number | null {
  if (!cron) return null;
  const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/);
  if (dom !== "*" || month !== "*" || dow !== "*") return null;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return 24;
  const every = hour.match(/^\*\/(\d+)$/);
  if (/^\d+$/.test(minute) && every) return Number(every[1]);
  if (/^\d+$/.test(minute) && hour === "*") return 1;
  return null;
}

/** A schedule in plain words, in Mountain time: "once a day at 6:17 AM". */
export function describeSchedule(cron: string | null, now = new Date()): string {
  if (!cron) return "not scheduled: it runs only when someone starts it";
  const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/);
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*") {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hour), Number(minute)));
    return `once a day at ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" })} Mountain time`;
  }
  const every = expectedEveryHours(cron);
  return every ? `every ${every === 1 ? "hour" : `${every} hours`}` : `on the schedule ${cron} (UTC)`;
}

/** Run a scheduled job and record the run. A failure is recorded and then thrown, so the scheduler sees it too. */
export async function recordRun<T extends Record<string, unknown>>(job: JobName, work: () => Promise<T>): Promise<T> {
  const [run] = await db.insert(jobRuns).values({ job, status: "RUNNING" }).returning({ id: jobRuns.id });
  try {
    const summary = await work();
    await db.update(jobRuns).set({ status: "OK", finishedAt: new Date(), summary }).where(eq(jobRuns.id, run.id));
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The kind of failure only: never request details, which can carry keys.
    await db
      .update(jobRuns)
      .set({ status: "FAILED", finishedAt: new Date(), error: message.slice(0, 500) })
      .where(eq(jobRuns.id, run.id))
      .catch(() => {});
    throw error;
  }
}

export type JobStatus = {
  job: JobName;
  label: string;
  schedule: string;
  scheduled: boolean;
  lastRun: JobRun | null;
  lastOk: JobRun | null;
  /** The job should have run by now and hasn't (or its last run failed). */
  late: boolean;
  failing: boolean;
};

/**
 * Where each job stands: last run, last success, and whether it's late or failing.
 * `waitingSince` is the oldest piece of work the job should have picked up (for sync, the oldest
 * waiting state record). A job that has never run is only late once that work has waited longer
 * than a full run interval: a brand-new deployment isn't "late" before its first scheduled time.
 */
export async function jobStatus(job: JobName, now = new Date(), waitingSince?: Date | null): Promise<JobStatus> {
  const [lastRun] = await db.select().from(jobRuns).where(eq(jobRuns.job, job)).orderBy(desc(jobRuns.startedAt)).limit(1);
  const [lastOk] = await db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.job, job), eq(jobRuns.status, "OK")))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);
  if (waitingSince === undefined && job === "sync") {
    // The sync job is platform-wide: its oldest work is the oldest waiting record anywhere.
    const [oldest] = await db.select({ at: min(syncEvents.createdAt) }).from(syncEvents).where(eq(syncEvents.status, "PENDING"));
    waitingSince = oldest?.at ?? null;
  } else if (waitingSince === undefined && job === "watch") {
    // The Tally Watch sweep has work as soon as any facility exists.
    const [oldest] = await db.select({ at: min(facilities.createdAt) }).from(facilities);
    waitingSince = oldest?.at ?? null;
  }
  const cron = cronFor(job);
  const every = expectedEveryHours(cron);
  // Late: a scheduled job with no success within its interval plus 2 hours' slack. With no success
  // on record at all, measure from its first attempt, or else from the oldest work waiting for it.
  const slack = every === null ? 0 : (every + 2) * 3600_000;
  const since = lastOk?.startedAt ?? lastRun?.startedAt ?? waitingSince ?? null;
  const late = every !== null && since !== null && now.getTime() - since.getTime() > slack;
  return {
    job,
    label: JOB_LABEL[job],
    schedule: describeSchedule(cron, now),
    scheduled: cron !== null,
    lastRun: lastRun ?? null,
    lastOk: lastOk ?? null,
    late,
    // A run still marked RUNNING after 10 minutes was cut off before it could finish.
    failing: lastRun?.status === "FAILED" || (lastRun?.status === "RUNNING" && now.getTime() - lastRun.startedAt.getTime() > 10 * 60_000),
  };
}

/**
 * Vercel calls scheduled jobs with "Authorization: Bearer <CRON_SECRET>" only when CRON_SECRET is set
 * in the project. If a scheduled call arrives and the secret isn't set, every run would be refused
 * silently; record it as a failed run instead so the app warns about it.
 */
export async function recordMissingSecret(job: JobName, request: Request): Promise<void> {
  if (process.env.CRON_SECRET) return;
  if (!(request.headers.get("user-agent") ?? "").toLowerCase().startsWith("vercel-cron")) return;
  await db
    .insert(jobRuns)
    .values({ job, status: "FAILED", finishedAt: new Date(), error: "CRON_SECRET is not set in Vercel, so the scheduled run was refused." })
    .catch(() => {});
}
