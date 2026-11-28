import "server-only";

/**
 * Sends one text message through the store's own cannabis-approved texting provider.
 *
 * Mainstream texting companies often ban cannabis marketing and carriers filter it, so Leaf2Sale does not pick a provider for
 * you. Point SMS_WEBHOOK_URL at your provider's send endpoint (or a small relay you run) and set SMS_WEBHOOK_SECRET.
 * Leaf2Sale posts JSON {"to": "+15055550142", "body": "..."} with "Authorization: Bearer <secret>", and treats any 2xx
 * answer as sent. With either setting missing nothing is sent and the caller is told why.
 */
export const smsConfigured = (): boolean => Boolean(process.env.SMS_WEBHOOK_URL && process.env.SMS_WEBHOOK_SECRET);

export async function sendSms(input: { phone: string; body: string }): Promise<{ sent: boolean; reason?: string }> {
  if (!smsConfigured()) return { sent: false, reason: "Texting isn't set up yet (SMS_WEBHOOK_URL and SMS_WEBHOOK_SECRET)." };
  try {
    const res = await fetch(process.env.SMS_WEBHOOK_URL!, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.SMS_WEBHOOK_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ to: `+1${input.phone}`, body: input.body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { sent: true };
    return { sent: false, reason: `The texting provider answered ${res.status}.` };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "The texting provider could not be reached." };
  }
}

/** Words that mean stop, as carriers and the CTIA guidelines define them. */
export const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"];

export const isStopMessage = (body: string): boolean => STOP_WORDS.includes(body.trim().toLowerCase().replace(/[^a-z]/g, ""));

/** A shopper confirming a text sign-up (double opt-in) by replying YES. */
export const isYesMessage = (body: string): boolean => ["yes", "y"].includes(body.trim().toLowerCase().replace(/[^a-z]/g, ""));
