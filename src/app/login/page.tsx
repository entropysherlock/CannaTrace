import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, inputClass } from "@/components/ui";
import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/setup";
import { signIn } from "./actions";

// Checks the database on every visit (is the system set up yet?), so it cannot be built ahead of time.
export const instant = false;

export default async function LoginPage() {
  if (await needsSetup()) redirect("/setup");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">Track every gram from seed to sale.</p>
        <ActionForm action={signIn} submitLabel="Sign in">
          <Field label="Email">
            <input name="email" type="email" autoComplete="email" required className={inputClass} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
          </Field>
        </ActionForm>
      </div>
    </main>
  );
}
