import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, inputClass } from "@/components/ui";
import { readPending } from "@/lib/two-factor";
import { verifySecondStep } from "./actions";

export const metadata = { title: "Enter your code · Leaf2Sale", robots: { index: false } };

// Reads the sign-in cookie on every visit, so it cannot be built ahead of time.
export const instant = false;

export default async function VerifyPage() {
  // Nobody gets here without first typing the right password.
  if (!(await readPending())) redirect("/login");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        <h1 className="text-2xl font-bold text-slate-900">Enter your code</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">Open your authenticator app and type the 6-digit code for Leaf2Sale.</p>
        <ActionForm action={verifySecondStep} submitLabel="Sign in">
          <Field label="Code" hint="Lost your phone? Type one of your recovery codes instead.">
            <input
              name="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              required
              spellCheck={false}
              data-testid="code"
              className={inputClass}
            />
          </Field>
        </ActionForm>
        <p className="mt-3 text-sm">
          <Link href="/login" className="font-semibold text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
