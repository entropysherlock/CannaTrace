import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { recordConsent } from "./loyalty-earn";

/** A shopper texted STOP: end text marketing for every shopper record with this number, keeping the record of when. */
export async function stopTexting(phone: string): Promise<number> {
  const members = await db.execute<{ id: string; org_id: string }>(sql`select id, org_id from reward_members where phone = ${phone}`);
  let stopped = 0;
  for (const m of members.rows) {
    const current = await db.execute<{ status: string }>(sql`select status from member_consents where member_id = ${m.id} and channel = 'SMS' order by created_at desc, id desc limit 1`);
    if (current.rows[0]?.status !== "OPTED_IN") continue;
    await recordConsent(db, { orgId: m.org_id, userName: "Shopper (text STOP)" }, { memberId: m.id, channel: "SMS", status: "OPTED_OUT", method: "STOP_REPLY" });
    stopped++;
  }
  return stopped;
}
