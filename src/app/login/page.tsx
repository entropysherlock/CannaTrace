import { ActionForm } from "@/components/action-form";
import { Field, inputClass } from "@/components/ui";
import { signIn } from "./actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">CannaTrace</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Sign in</h1>
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
