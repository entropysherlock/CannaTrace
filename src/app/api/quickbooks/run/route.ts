import { timingSafeEqual } from "node:crypto";
import { recordMissingSecret, recordRun } from "@/lib/job-runs";
import { syncAllQuickbooks } from "@/lib/quickbooks";

export const maxDuration = 60;

/** Scheduled QuickBooks sync. Call with "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    await recordMissingSecret("quickbooks", request);
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    return Response.json(
      await recordRun("quickbooks", async () => {
        const r = await syncAllQuickbooks();
        if (r.failed > 0 && r.invoices + r.payments === 0) throw new Error(`Nothing was sent to QuickBooks: ${r.firstError ?? "unknown error"}`);
        return { ...r };
      }),
    );
  } catch {
    return Response.json({ error: "The run failed. It is recorded in job_runs." }, { status: 500 });
  }
}
