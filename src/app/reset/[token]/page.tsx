import Link from "next/link";
import { connection } from "next/server";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, inputClass } from "@/components/ui";
import { InventoryError } from "@/lib/inventory-math";
import { lookupReset } from "@/lib/team";
import { resetPasswordAction } from "./actions";

export const instant = false;
export const metadata = { title: "Set a new password · CannaTrace", robots: { index: false } };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Whether the link is still good depends on the time of the request, so never prerender this.
  await connection();
  let who: { name: string; email: string } | null = null;
  let problem = "";
  try {
    who = await lookupReset(token);
  } catch (error) {
    problem = error instanceof InventoryError ? error.message : "This reset link isn't valid.";
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4 py-10">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        {who ? (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Set a new password</h1>
            <p className="mb-5 mt-1 text-sm text-slate-600">
              For <strong className="text-slate-900">{who.name}</strong>. Anywhere you&apos;re still signed in will be signed out.
            </p>
            <ActionForm action={resetPasswordAction} submitLabel="Save new password">
              <input type="hidden" name="token" value={token} />
              <Field label="Email">
                <input value={who.email} readOnly autoComplete="username" className={`${inputClass} bg-slate-50 text-slate-600`} />
              </Field>
              <Field label="New password" hint="At least 12 characters.">
                <input name="password" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </Field>
              <Field label="New password again">
                <input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </Field>
            </ActionForm>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Reset link not available</h1>
            <p className="mb-5 mt-2 text-sm text-slate-600">{problem}</p>
            <Link href="/login" className="font-semibold text-brand-700 hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
