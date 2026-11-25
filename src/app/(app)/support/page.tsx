import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Disclosure } from "@/components/disclosure";
import { SecretGenerator } from "@/components/secret-generator";
import { StateSelect } from "@/components/state-select";
import { encryptionStatus, secretLength } from "@/lib/ai/secret-box";
import { licenseTypeEnum } from "@/db/schema";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { jobStatus } from "@/lib/job-runs";
import { isPlatformAdmin, listCustomerAccounts, listSupportAdmins, recentSupportVisits, type CustomerAccount } from "@/lib/platform-admin";
import { stateName } from "@/lib/states";
import { requireSession } from "@/lib/session";
import { sentryDsn } from "@/lib/sentry-options";
import { addAdminAction, businessAccessAction, createBusinessAction, openAccountAction, removeAdminAction, sendTestCrashAction } from "./actions";

export const metadata = { title: "Support Console · Leaf2Sale" };

const when = (d: Date | null) =>
  d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver" }) : "never";

type Facility = { name: string; state: string; licenseNumber: string };
const ACCESS: Record<CustomerAccount["access"], { label: string; tone: string; note: string }> = {
  approved: { label: "Has access", tone: "bg-emerald-100 text-emerald-800", note: "Owner and staff can sign in." },
  listed: { label: "Your business", tone: "bg-sky-100 text-sky-800", note: "In through the server's email list." },
  suspended: { label: "Suspended", tone: "bg-red-100 text-red-800", note: "Nobody here can sign in. You can still open it." },
  none: { label: "No access", tone: "bg-slate-200 text-slate-700", note: "Nobody here can sign in until you give access." },
};

const facilityMatches = (f: Facility, q: string) =>
  Boolean(q) &&
  (f.name.toLowerCase().includes(q) || f.licenseNumber.toLowerCase().includes(q) || f.state.toLowerCase() === q || stateName(f.state).toLowerCase().includes(q));

export default async function SupportConsolePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  if (session.support || !(await isPlatformAdmin(session.userId))) redirect("/dashboard");
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const [accounts, admins, visits, jobs] = await Promise.all([
    listCustomerAccounts(),
    listSupportAdmins(),
    recentSupportVisits(15),
    Promise.all([jobStatus("sync"), jobStatus("watch")]),
  ]);
  const jobTime = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
  const shown = accounts.filter(
    (a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.owners.some((o) => o.toLowerCase().includes(q)) ||
      a.facilities.some((f) => facilityMatches(f, q)),
  );
  const real = accounts.filter((a) => !a.isDemo);

  return (
    <>
      <PageHeader
        title="Support Console"
        subtitle={`${real.length} business${real.length === 1 ? "" : "es"} on Leaf2Sale. Open any account to see exactly what the customer sees and help them.`}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <form className="flex gap-2" role="search">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search by business, owner email, facility, license number, or state"
              aria-label="Search businesses"
              className={inputClass}
            />
            <button type="submit" className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800">
              Search
            </button>
          </form>
          <Disclosure title="Set up a new business" defaultOpen={real.length < 3}>
            <ActionForm action={createBusinessAction} submitLabel="Create business" className="space-y-3 border-t border-slate-100 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Business (company) name">
                  <input name="businessName" required maxLength={100} className={inputClass} />
                </Field>
                <Field label="First facility name" hint="For example its street or nickname. More can be added later in their Settings.">
                  <input name="facilityName" required maxLength={100} className={inputClass} />
                </Field>
                <Field label="State license number">
                  <input name="licenseNumber" required maxLength={60} className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
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
                  <Field label="State">
                    <StateSelect />
                  </Field>
                </div>
                <Field label="Owner's email" hint="They get an invite link to set their own password. It must not already have a Leaf2Sale account.">
                  <input name="ownerEmail" type="email" required className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </Disclosure>
          {shown.length === 0 ? <p className="rounded-lg bg-white p-6 text-sm text-slate-600">No businesses match.</p> : null}
          <ul className="space-y-3">
            {shown.map((a) => (
              <li key={a.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-slate-950">
                      {a.name}
                      {a.isDemo ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">live demo</span> : null}
                    </h2>
                    <p className="text-sm text-slate-600">
                      {a.owners.length ? `Owner ${a.owners.join(", ")}` : "No active owner"} · {a.users} user{a.users === 1 ? "" : "s"} · {a.packages} package
                      {a.packages === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Joined {when(a.createdAt)} · last activity {when(a.lastActivity)}
                    </p>
                  </div>
                  {a.isDemo ? null : (
                    <div className="space-y-2 text-sm sm:max-w-xs sm:text-right" data-testid={`access-${a.id}`}>
                      <p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ACCESS[a.access].tone}`}>{ACCESS[a.access].label}</span>
                        <span className="mt-1 block text-xs text-slate-500">{ACCESS[a.access].note}</span>
                      </p>
                      {a.access === "suspended" || a.access === "none" ? (
                        <ActionForm action={businessAccessAction} submitLabel={a.access === "suspended" ? "Restore access" : "Give access"} quiet>
                          <input type="hidden" name="orgId" value={a.id} />
                          <input type="hidden" name="access" value="approve" />
                        </ActionForm>
                      ) : a.id !== session.orgId ? (
                        <Disclosure title="Suspend access">
                          <ActionForm action={businessAccessAction} submitLabel="Suspend" quiet className="space-y-2 pt-2">
                            <input type="hidden" name="orgId" value={a.id} />
                            <input type="hidden" name="access" value="suspend" />
                            <input
                              name="reason"
                              required
                              maxLength={300}
                              placeholder="Why? e.g. Unpaid since Dec 1"
                              aria-label={`Reason for suspending ${a.name}`}
                              className={inputClass}
                            />
                          </ActionForm>
                        </Disclosure>
                      ) : null}
                    </div>
                  )}

                </div>
                {a.facilities.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No facilities yet, so there is nothing to open.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200" aria-label={`Facilities of ${a.name}`}>
                    {a.facilities.map((f) => (
                      <li key={f.id} className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2 ${facilityMatches(f, q) ? "bg-amber-50" : ""}`}>
                        <span className="min-w-0">
                          <span className="font-semibold text-slate-900">{f.name}</span>
                          <span className="block text-sm text-slate-600">
                            {stateName(f.state)} · {f.licenseType.toLowerCase()} · license {f.licenseNumber}
                          </span>
                        </span>
                        <ActionForm action={openAccountAction} submitLabel="Open" className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="orgId" value={a.id} />
                          <input type="hidden" name="facilityId" value={f.id} />
                          <input
                            name="reason"
                            required
                            maxLength={300}
                            placeholder="Why? e.g. Label printing help"
                            aria-label={`Reason for opening ${f.name}`}
                            className={`${inputClass} sm:w-64`}
                          />
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-5">
          {/* Scheduled jobs: when each last ran, and whether it is failing or late. */}
          <Card title="Scheduled jobs">
            <ul className="space-y-3 text-sm" data-testid="job-status">
              {jobs.map((j) => (
                <li key={j.job}>
                  <p className="flex items-center justify-between gap-2 font-semibold text-slate-900">
                    {j.label}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${j.failing ? "bg-red-100 text-red-800" : j.late ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}
                    >
                      {j.failing ? "Failing" : j.late ? "Late" : "OK"}
                    </span>
                  </p>
                  <p className="text-slate-600">Runs {j.schedule}.</p>
                  <p className="text-slate-600">
                    {j.lastRun ? `Last run ${jobTime(j.lastRun.startedAt)}: ${j.lastRun.status.toLowerCase()}` : "Has not run yet"}
                    {j.lastRun?.error ? ` (${j.lastRun.error})` : ""}.
                    {j.lastOk && j.lastOk.id !== j.lastRun?.id ? ` Last success ${jobTime(j.lastOk.startedAt)}.` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Crash alerts">
            {sentryDsn ? (
              <div className="space-y-3 text-sm text-slate-700" data-testid="crash-alerts">
                <p>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">On</span> Any crash on a page, a save or a
                  customer&apos;s screen is sent to Sentry, which emails you. Reports carry the error and the page, never customer or store data.
                </p>
                <ActionForm action={sendTestCrashAction} submitLabel="Send a test crash" quiet>
                  <p className="text-slate-600">Sends one labelled test error so you can see an alert arrive.</p>
                </ActionForm>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-slate-700" data-testid="crash-alerts">
                <p className="font-semibold text-amber-900">Off: nothing tells you when the app crashes for a customer.</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Make a free account at sentry.io and create a project (platform: Next.js).</li>
                  <li>Copy the project&apos;s DSN (Settings → Client Keys). It looks like https://…@…ingest.sentry.io/….</li>
                  <li>In Vercel: the Leaf2Sale project → Settings → Environment Variables → add NEXT_PUBLIC_SENTRY_DSN with that value (Production).</li>
                  <li>
                    For readable stack traces, also add SENTRY_AUTH_TOKEN (Sentry → Settings → Auth Tokens), SENTRY_ORG and SENTRY_PROJECT (your
                    organization and project names in Sentry).
                  </li>
                  <li>Redeploy, come back here, and press Send a test crash.</li>
                </ol>
              </div>
            )}
          </Card>

          <Card title="How support visits work">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>You see and can do everything the business owner can.</li>
              <li>Anything you change is saved under your name, marked &quot;Leaf2Sale support&quot;.</li>
              <li>The visit and your reason go into the customer&apos;s own audit trail.</li>
              <li>A visit ends when you press Exit support view, or after 2 hours.</li>
            </ul>
          </Card>

          <Card title="Tally key storage">
            {encryptionStatus() === "ready" ? (
              <p className="text-sm text-slate-700">Set up. Businesses can connect their own Claude accounts in Settings → Tally AI.</p>
            ) : (
              <div className="space-y-3 text-sm text-slate-700">
                <p className="font-semibold text-amber-900">
                  {encryptionStatus() === "invalid"
                    ? `AI_KEY_ENCRYPTION_KEY is set in Vercel, but its value is only ${secretLength()} characters long, so something else was pasted. Edit it in Vercel, paste a fresh generated value (44 characters), save, and redeploy.`
                    : "Not set up yet: AI_KEY_ENCRYPTION_KEY is missing or empty on this server. Businesses can't connect Tally until it is set."}
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Press Generate and Copy below. The value is made in your browser and never sent to Leaf2Sale.</li>
                  <li>In Vercel: the Leaf2Sale project → Settings → Environment Variables → add AI_KEY_ENCRYPTION_KEY with that value (Production).</li>
                  <li>Redeploy. Keep the value secret and never change it; changing it would disconnect every business.</li>
                </ol>
                <SecretGenerator />
              </div>
            )}
          </Card>

          <Card title="Support team">
            <ul className="divide-y divide-slate-100 text-sm">
              {admins.map((a) => (
                <li key={a.userId} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-semibold">{a.name}</span>
                    <span className="block text-slate-600">{a.email}</span>
                    <span className="block text-xs text-slate-500">{a.founder ? "Founder" : `Added by ${a.addedBy}`}</span>
                  </span>
                  {!a.founder && a.userId !== session.userId ? (
                    <ActionForm action={removeAdminAction} submitLabel="Remove" quiet>
                      <input type="hidden" name="userId" value={a.userId} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            <ActionForm action={addAdminAction} submitLabel="Add to support team" className="mt-3 space-y-2">
              <Field label="Email of their Leaf2Sale account" hint="They need an account first. Only add people who work for Leaf2Sale.">
                <input name="email" type="email" required className={inputClass} />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Recent support visits">
            {visits.length === 0 ? (
              <p className="text-sm text-slate-600">None yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {visits.map((v, i) => (
                  <li key={i}>
                    <span className="font-semibold">{v.org}</span> · {v.action === "SUPPORT_VISIT_START" ? "opened" : "left"} by {v.who.replace(" (Leaf2Sale support)", "")}
                    <span className="block text-xs text-slate-500">
                      {when(v.at)}
                      {v.reason ? ` · ${v.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
