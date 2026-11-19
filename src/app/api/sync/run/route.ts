import { timingSafeEqual } from "node:crypto";
import { processWebhooks } from "@/lib/integrations";
import { processQueue } from "@/lib/sync";
import { deleteExpiredAttachments } from "@/lib/assistant/attachments/store";
import { recordMissingSecret, recordRun } from "@/lib/job-runs";

export const maxDuration = 60;

/**
 * Sends everything that is due, for every facility: state reports and webhooks. Scheduled in vercel.json
 * (currently once a day; the Send now button on State reporting sends a facility's records any time).
 * Call with the header "Authorization: Bearer <CRON_SECRET>". Every run is recorded in job_runs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok =
    Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    await recordMissingSecret("sync", request);
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    const summary = await recordRun("sync", async () => {
      const [state, webhooks, expiredFiles] = await Promise.all([processQueue(), processWebhooks(), deleteExpiredAttachments()]);
      return { state, webhooks, expiredFiles };
    });
    return Response.json(summary);
  } catch {
    return Response.json({ error: "The run failed. It is recorded in job_runs." }, { status: 500 });
  }
}
