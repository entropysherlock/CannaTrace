import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, inputClass } from "@/components/ui";
import { licenseTypeEnum } from "@/db/schema";
import { signupAction } from "./actions";

export const metadata = { title: "Create your CannaTrace account" };

export default function SignupPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4 py-10">
      <Link href="/" className="mb-6">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-900/5">
        <h1 className="text-2xl font-bold text-slate-900">Create your business account</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">
          You become the owner. After this you can invite your staff, set what each of them can do, and add more licenses.
        </p>
        <ActionForm action={signupAction} submitLabel="Create my account">
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <Field label="Business name">
            <input name="businessName" required className={inputClass} />
          </Field>
          <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">Your first licensed facility</legend>
            <Field label="Facility name" hint="What your staff call it, such as its street name.">
              <input name="facilityName" required className={inputClass} />
            </Field>
            <Field label="State license number">
              <input name="licenseNumber" required autoCapitalize="characters" className={inputClass} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Field label="License type">
                  <select name="licenseType" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose one
                    </option>
                    {licenseTypeEnum.enumValues.map((type) => (
                      <option key={type} value={type}>
                        {type.charAt(0) + type.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="State">
                <input name="state" required maxLength={2} autoCapitalize="characters" className={inputClass} />
              </Field>
            </div>
          </fieldset>
          <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">You, the owner</legend>
            <Field label="Your name">
              <input name="ownerName" required autoComplete="name" className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required autoComplete="email" className={inputClass} />
            </Field>
            <Field label="Password" hint="At least 12 characters. This account can see and change everything.">
              <input name="password" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
            </Field>
            <Field label="Password again">
              <input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
            </Field>
          </fieldset>
        </ActionForm>
        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
