import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { jobRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { cronFor, describeSchedule, expectedEveryHours, jobStatus, recordRun } from "@/lib/job-runs";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("scheduled jobs, as the app describes them", () => {
  it("reads the real schedules from vercel.json", () => {
    expect(cronFor("sync")).toBe("17 13 * * *");
    expect(cronFor("watch")).toBe("41 11 * * *");
  });
  it("says when they run in plain words, in Mountain time, through daylight saving", () => {
    expect(describeSchedule("17 13 * * *", new Date("2026-01-15T12:00:00Z"))).toBe("once a day at 6:17 AM Mountain time");
    expect(describeSchedule("17 13 * * *", new Date("2026-07-15T12:00:00Z"))).toBe("once a day at 7:17 AM Mountain time");
    expect(describeSchedule(null)).toMatch(/not scheduled/);
    expect(describeSchedule("0 */6 * * *")).toBe("every 6 hours");
  });
  it("knows how often each is meant to run", () => {
    expect(expectedEveryHours("17 13 * * *")).toBe(24);
    expect(expectedEveryHours("5 * * * *")).toBe(1);
    expect(expectedEveryHours("0 9 * * 1")).toBeNull();
  });
});

describe.skipIf(!hasDb)("recording each run (database)", () => {
  afterAll(async () => {
    await db.delete(jobRuns).where(eq(jobRuns.job, "watch"));
  });
  it("records a run that worked and one that failed, and flags a job that's failing or late", async () => {
    await db.delete(jobRuns).where(eq(jobRuns.job, "watch"));
    expect(await jobStatus("watch")).toMatchObject({ lastRun: null, late: true, failing: false });
    expect(await recordRun("watch", async () => ({ facilities: 3 }))).toEqual({ facilities: 3 });
    expect(await jobStatus("watch")).toMatchObject({ late: false, failing: false, lastRun: { status: "OK", summary: { facilities: 3 } } });
    await expect(recordRun("watch", async () => Promise.reject(new Error("database went away")))).rejects.toThrow(/went away/);
    const failing = await jobStatus("watch");
    expect(failing).toMatchObject({ failing: true, lastRun: { status: "FAILED", error: "database went away" } });
    expect(failing.lastOk?.status).toBe("OK");
    // A day and a half later with no new success, a daily job is late
    expect((await jobStatus("watch", new Date(Date.now() + 36 * 3600_000))).late).toBe(true);
  });
  it("treats a run that never finished (cut off) as failing once it's clearly stuck", async () => {
    await db.delete(jobRuns).where(eq(jobRuns.job, "watch"));
    await db.insert(jobRuns).values({ job: "watch", status: "RUNNING", startedAt: new Date(Date.now() - 20 * 60_000) });
    expect((await jobStatus("watch")).failing).toBe(true);
  });
});
