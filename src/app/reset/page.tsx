import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Forgot your password? · CannaTrace", robots: { index: false } };

/** No email is sent yet, so a manager makes the reset link. This page says how to get one. */
export default function ForgotPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4 py-10">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        <h1 className="text-2xl font-bold text-slate-900">Forgot your password?</h1>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Ask an owner at your business (or whoever manages your team) to open <strong>Team</strong> in CannaTrace and press <strong>Reset password</strong> next to your name.</li>
          <li>They&apos;ll send you a link. Open it within 24 hours and choose a new password.</li>
        </ol>
        <p className="mt-4 text-sm text-slate-600">
          If you&apos;re the only owner and can&apos;t sign in, contact CannaTrace support from the email address on your account.
        </p>
        <Link href="/login" className="mt-5 inline-block font-semibold text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
