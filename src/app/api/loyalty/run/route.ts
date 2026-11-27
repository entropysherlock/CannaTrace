import { timingSafeEqual } from "node:crypto";
import { recordMissingSecret, recordRun } from "@/lib/job-runs";
import { runAutomations } from "@/lib/marketing";

export const maxDuration = 300;

/** Scheduled automatic customer messages (welcome, birthday, win-back). Call with "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    await recordMissingSecret("loyalty", request);
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    return Response.json(
      await recordRun("loyalty", async () => {
        const result = await runAutomations();
        // Every attempt failing is a failed run, with the reason, so Support sees it instead of a quiet "ok".
        if (result.failed > 0 && result.sent === 0) throw new Error(`No automatic messages were sent: ${result.failed} failed.`);
        return { ...result };
      }),
    );
  } catch {
    return Response.json({ error: "The run failed. It is recorded in job_runs." }, { status: 500 });
  }
}
