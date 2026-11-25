import Link from "next/link";
import { signupsOpen } from "@/lib/access";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, inputClass } from "@/components/ui";
import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/setup";
import { signIn } from "./actions";

// Checks the database on every visit (is the system set up yet?), so it cannot be built ahead of time.
export const instant = false;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await needsSetup()) redirect("/setup");
  const { reset } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">Track every gram from seed to sale.</p>
        {reset ? (
          <p role="status" className="mb-4 rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
            Your password was changed. Sign in with the new one.
          </p>
        ) : null}
        <ActionForm action={signIn} submitLabel="Sign in">
          <Field label="Email">
            <input name="email" type="email" autoComplete="email" required className={inputClass} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
          </Field>
        </ActionForm>
        <p className="mt-3 text-sm">
          <Link href="/reset" className="font-semibold text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
        {signupsOpen() ? (
          <p className="mt-5 text-center text-sm text-slate-600">
            New to Leaf2Sale?{" "}
            <Link href="/signup" className="font-semibold text-brand-700 hover:underline">
              Create a business account
            </Link>
          </p>
        ) : (
          <p className="mt-5 text-center text-sm text-slate-600">Leaf2Sale is invite-only right now.</p>
        )}
        <p className="mt-4 flex justify-center gap-4 text-xs text-slate-500">
          <Link href="/terms" className="hover:text-brand-700">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-brand-700">
            Privacy
          </Link>
          <Link href="/data-agreement" className="hover:text-brand-700">
            Data Agreement
          </Link>
        </p>
      </div>
    </main>
  );
}
