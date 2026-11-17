import { timingSafeEqual } from "node:crypto";
import { processWebhooks } from "@/lib/integrations";
import { processQueue } from "@/lib/sync";
import { deleteExpiredAttachments } from "@/lib/assistant/attachments/store";

/**
 * Sends everything that is due, for every facility: state reports and webhooks. Call it on a schedule (for example
 * Vercel Cron every few minutes) with the header "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok =
    Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return Response.json({ error: "Not allowed." }, { status: 401 });
  const [state, webhooks, expiredFiles] = await Promise.all([processQueue(), processWebhooks(), deleteExpiredAttachments()]);
  return Response.json({ state, webhooks, expiredFiles });
}
