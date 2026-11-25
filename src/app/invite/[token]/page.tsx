import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, inputClass } from "@/components/ui";
import { currentSession } from "@/lib/session";
import { lookupInvite } from "@/lib/team";
import { acceptInviteAction } from "./actions";

export const instant = false;
export const metadata = { title: "Join your team on Leaf2Sale", robots: { index: false } };

const PROBLEMS = {
  missing: "This invite link is not valid. Check that you copied the whole link.",
  used: "This invite has already been used. Sign in with the email it was sent to.",
  revoked: "This invite was cancelled. Ask whoever invited you for a new one.",
  expired: "This invite has expired. Ask whoever invited you for a new one.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, signedIn] = await Promise.all([lookupInvite(token), currentSession()]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4 py-10">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        {invite.status === "ok" ? (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Join {invite.businessName}</h1>
            <p className="mb-5 mt-1 text-sm text-slate-600">
              You&apos;ve been invited as <strong className="text-slate-900">{invite.roleName}</strong>. Choose your password to finish.
            </p>
            {signedIn ? (
              <p role="note" data-testid="signed-in-note" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>{signedIn.name}</strong> is signed in on this browser. A browser holds one Leaf2Sale sign-in at a time, so joining here
                signs them out. To keep both signed in, open this link in a private window or another browser.
              </p>
            ) : null}
            <ActionForm action={acceptInviteAction} submitLabel="Join the team">
              <input type="hidden" name="token" value={token} />
              <Field label="Email">
                <input value={invite.email} readOnly className={`${inputClass} bg-slate-50 text-slate-600`} />
              </Field>
              <Field label="Your name">
                <input name="name" required autoComplete="name" className={inputClass} />
              </Field>
              <Field label="Password" hint="At least 12 characters.">
                <input name="password" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </Field>
              <Field label="Password again">
                <input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </Field>
            </ActionForm>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Invite not available</h1>
            <p className="mb-5 mt-2 text-sm text-slate-600">{PROBLEMS[invite.status]}</p>
            <Link href="/login" className="font-semibold text-brand-700 hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
