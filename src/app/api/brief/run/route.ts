import { timingSafeEqual } from "node:crypto";
import { recordMissingSecret, recordRun } from "@/lib/job-runs";
import { sendMorningBriefs } from "@/lib/morning-brief";

export const maxDuration = 60;

/** Scheduled morning-brief emails. Call with "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    await recordMissingSecret("brief", request);
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    return Response.json(
      await recordRun("brief", async () => {
        const result = await sendMorningBriefs();
        // Every attempt failing is a failed run, with the reason, so Support sees it instead of a quiet "ok".
        if (result.failed > 0 && result.sent === 0) throw new Error(`No briefs were sent: ${result.firstError ?? "unknown error"}`);
        return { ...result };
      }),
    );
  } catch {
    return Response.json({ error: "The run failed. It is recorded in job_runs." }, { status: 500 });
  }
}
