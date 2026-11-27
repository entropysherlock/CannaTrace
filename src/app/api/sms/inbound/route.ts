import { timingSafeEqual } from "node:crypto";
import { stopTexting } from "@/lib/marketing-inbound";
import { isStopMessage } from "@/lib/sms";
import { normalizePhone } from "@/lib/rewards-math";

/**
 * Replies from shoppers, forwarded by the texting provider as JSON {"from": "+15055550142", "body": "STOP"} with
 * "Authorization: Bearer <SMS_WEBHOOK_SECRET>". A stop word ends texts to that number right away and is kept as a record.
 */
export async function POST(request: Request) {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return Response.json({ error: "Not allowed." }, { status: 401 });
  const payload = (await request.json().catch(() => null)) as { from?: unknown; body?: unknown } | null;
  const phone = normalizePhone(payload?.from);
  if (!phone || typeof payload?.body !== "string") return Response.json({ error: "Send {from, body}." }, { status: 400 });
  if (!isStopMessage(payload.body)) return Response.json({ ok: true, stopped: 0 });
  return Response.json({ ok: true, stopped: await stopTexting(phone) });
}
