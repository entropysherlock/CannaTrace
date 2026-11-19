import { Field, inputClass } from "./ui";

// The steps of the guided "Add a vendor" and "Add a destination" drawers. Field names match the
// Vendors page, so the server reads them the same way. Safe in server and client components.

/** Step 1: the business and the state license it holds. */
export function VendorLicenseFields({ role }: { role: "buy" | "sell" }) {
  return (
    <>
      <input type="hidden" name="role" value={role} />
      <Field label="Business name">
        <input name="name" required maxLength={120} className={inputClass} />
      </Field>
      <LicenseFields />
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" name="alsoOtherRole" className="h-5 w-5 accent-brand-700" />
        {role === "buy" ? "We also sell to them" : "We also buy from them"}
      </label>
    </>
  );
}

/** A state license: number, type, and expiry. Required for every vendor and destination. */
export function LicenseFields() {
  return (
    <>
      <Field label="State license number">
        <input name="licenseNumber" required maxLength={60} autoCapitalize="characters" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="License type">
          <input name="licenseType" required maxLength={60} placeholder="e.g. Retailer" className={inputClass} />
        </Field>
        <Field label="License expires">
          <input name="licenseExpires" type="date" required className={inputClass} />
        </Field>
      </div>
    </>
  );
}

/** Step 2: who to talk to, where they are, and payment terms. All optional. */
export function VendorContactFields({ terms = true }: { terms?: boolean }) {
  return (
    <>
      <Field label="Address (optional)">
        <input name="address" maxLength={300} className={inputClass} />
      </Field>
      <Field label="Contact name (optional)">
        <input name="contactName" maxLength={100} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Email (optional)">
          <input name="email" type="email" maxLength={200} className={inputClass} />
        </Field>
        <Field label="Phone (optional)">
          <input name="phone" type="tel" maxLength={40} className={inputClass} />
        </Field>
      </div>
      {terms ? (
        <Field label="Payment terms, in days">
          <input name="paymentTermsDays" inputMode="numeric" defaultValue="0" className={inputClass} />
        </Field>
      ) : null}
    </>
  );
}

/**
 * Last step: the license check. Ticking the box is the same attestation as "Mark license verified" on
 * the vendor's page, by the same person, logged the same way. Left unticked, the record starts
 * unverified, and orders to it can't be confirmed or shipped until someone verifies it.
 */
export function LicenseCheckFields() {
  return (
    <>
      <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm leading-relaxed text-brand-950">
        Before you can ship to a license, someone has to look it up on the state&apos;s license search and confirm it&apos;s active. You can do that now, or later from
        the vendor&apos;s page.
      </p>
      <label className="flex items-start gap-3 rounded-lg border-2 border-slate-200 p-3 text-sm font-medium text-slate-900">
        <input type="checkbox" name="verifyNow" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700" />
        <span>I looked this license up on the state&apos;s license search today, and it is active with the expiry date I entered.</span>
      </label>
      <p className="text-xs text-slate-600">Leave it unticked if you haven&apos;t checked. It will show as not verified until someone does.</p>
    </>
  );
}
