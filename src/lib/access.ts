/**
 * Who may use Leaf2Sale right now. While it's invite-only, only the listed emails can sign in, sign-up is
 * closed, and the live demo is off. Change the list in Vercel with ALLOWED_SIGNIN_EMAILS (comma-separated),
 * open sign-up with SIGNUPS_OPEN=true, and turn the live demo on with LIVE_DEMO=on.
 * OPEN_ACCESS=1 lifts the lock entirely: for automated tests and local development only, never production.
 */

const DEFAULT_ALLOWED = ["calebwestfall1989@gmail.com", "ccwestfall85@gmail.com"];

export const openAccess = () => process.env.OPEN_ACCESS === "1";

export function allowedEmails(): string[] {
  const list = process.env.ALLOWED_SIGNIN_EMAILS?.trim() ? process.env.ALLOWED_SIGNIN_EMAILS.split(",") : DEFAULT_ALLOWED;
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Whether this email may sign in (and stay signed in). */
export const canSignIn = (email: string | null | undefined) => openAccess() || allowedEmails().includes((email ?? "").trim().toLowerCase());

/** Whether new businesses may sign up. */
export const signupsOpen = () => openAccess() || process.env.SIGNUPS_OPEN === "true";

/** Whether the shared live demo is on: off while invite-only, unless LIVE_DEMO=on. */
export const liveDemoOn = () => process.env.LIVE_DEMO === "on" || (openAccess() && process.env.LIVE_DEMO !== "off");

export const INVITE_ONLY_MESSAGE = "Leaf2Sale is invite-only right now. Email us to book a demo.";
