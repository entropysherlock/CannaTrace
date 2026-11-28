import "server-only";
import { eq, sql } from "drizzle-orm";
import { rewardMembers } from "@/db/schema";
import { db } from "./db";
import { sendEmail } from "./email";
import { CONSENT_WORDING, ensureCodes, recordConsent, type Channel } from "./loyalty-earn";
import { sendSms } from "./sms";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://leaf2sale.com";

/** A shopper texted STOP: end text marketing for every shopper record with this number, keeping the record of when. A pending sign-up is cancelled too. */
export async function stopTexting(phone: string): Promise<number> {
  const members = await db.execute<{ id: string; org_id: string }>(sql`select id, org_id from reward_members where phone = ${phone}`);
  let stopped = 0;
  for (const m of members.rows) {
    const current = await db.execute<{ status: string }>(sql`select status from member_consents where member_id = ${m.id} and channel = 'SMS' order by created_at desc, id desc limit 1`);
    if (current.rows[0]?.status !== "OPTED_IN" && current.rows[0]?.status !== "PENDING") continue;
    await recordConsent(db, { orgId: m.org_id, userName: "Shopper (text STOP)" }, { memberId: m.id, channel: "SMS", status: "OPTED_OUT", method: "STOP_REPLY" });
    stopped++;
  }
  return stopped;
}

/** A shopper replied YES to the confirmation text: turn their pending text sign-up into a real one, keeping the record. */
export async function confirmTexting(phone: string): Promise<number> {
  const members = await db.execute<{ id: string; org_id: string }>(sql`select id, org_id from reward_members where phone = ${phone}`);
  let confirmed = 0;
  for (const m of members.rows) {
    const current = await db.execute<{ status: string }>(sql`select status from member_consents where member_id = ${m.id} and channel = 'SMS' order by created_at desc, id desc limit 1`);
    if (current.rows[0]?.status !== "PENDING") continue;
    await recordConsent(db, { orgId: m.org_id, userName: "Shopper (replied YES)" }, { memberId: m.id, channel: "SMS", status: "OPTED_IN", method: "CONFIRM_REPLY", wording: `${CONSENT_WORDING.SMS} (confirmed by replying YES)` });
    confirmed++;
  }
  return confirmed;
}

/**
 * Double opt-in: send each pending channel its one confirmation message. Nothing marketing goes out until the shopper answers.
 * Email gets a link to their private card page, where one tap confirms. Text asks them to reply YES.
 */
export async function askToConfirm(memberId: string, channels: Channel[]): Promise<void> {
  const [member] = await db.select().from(rewardMembers).where(eq(rewardMembers.id, memberId));
  if (!member) return;
  const org = (await db.execute<{ name: string }>(sql`select name from organizations where id = ${member.orgId}`)).rows[0];
  const shop = org?.name ?? "the store";
  const { cardToken } = await ensureCodes(db, member);
  const link = `${SITE_URL}/card/${cardToken}`;
  if (channels.includes("EMAIL") && member.email) {
    const text = `Hi ${member.firstName}, tap this link to confirm you want emails from ${shop}: ${link}\n\nIf this wasn't you, ignore this message and you won't get any.`;
    await sendEmail({ to: member.email, subject: `Confirm your emails from ${shop}`, text, html: `<p style="font-family:system-ui,sans-serif">Hi ${member.firstName.replace(/[<>&]/g, "")}, <a href="${link}">tap here to confirm</a> you want emails from ${shop.replace(/[<>&]/g, "")}.</p><p style="font-family:system-ui,sans-serif;font-size:13px;color:#64748b">If this wasn't you, ignore this message and you won't get any.</p>` }).catch(() => null);
  }
  if (channels.includes("SMS")) {
    await sendSms({ phone: member.phone, body: `${shop}: Reply YES to get recurring text offers from us. Msg & data rates may apply. Reply STOP to cancel.` }).catch(() => null);
  }
}
