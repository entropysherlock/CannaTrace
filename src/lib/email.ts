import "server-only";

/**
 * Sends one email through Resend (https://resend.com). Needs RESEND_API_KEY and MAIL_FROM
 * (for example `Leaf2Sale <brief@leaf2sale.com>`, on a domain verified at Resend). With either missing,
 * nothing is sent and the caller is told why, so a missing setting is never mistaken for a sent email.
 */
export const emailConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<{ sent: boolean; reason?: string }> {
  if (!emailConfigured()) return { sent: false, reason: "Email isn't set up yet (RESEND_API_KEY and MAIL_FROM)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { sent: true };
    const detail = await res.text().catch(() => "");
    return { sent: false, reason: `Resend answered ${res.status}. ${detail.slice(0, 200)}` };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "The email service could not be reached." };
  }
}
