import { timingSafeEqual } from "node:crypto";
import { deleteExpiredAttachments } from "@/lib/assistant/attachments/store";
import { recordMissingSecret, recordRun } from "@/lib/job-runs";
import { sweepAll } from "@/lib/watch";

export const maxDuration = 60;

/** Scheduled Tally Watch sweep of every facility. Call with "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    await recordMissingSecret("watch", request);
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    return Response.json(await recordRun("watch", async () => ({ ...(await sweepAll()), expiredFiles: await deleteExpiredAttachments() })));
  } catch {
    return Response.json({ error: "The run failed. It is recorded in job_runs." }, { status: 500 });
  }
}
