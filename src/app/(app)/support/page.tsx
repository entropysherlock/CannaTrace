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

const DAY = 86_400_000;
/** The page is rendered fresh on every visit, so reading the clock here is intended. */
const currentTime = () => Date.now();
type Standing = "active" | "quiet" | "dormant" | "unused";
const STANDING: Record<Standing, { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-emerald-100 text-emerald-800" },
  quiet: { label: "Quiet", tone: "bg-amber-100 text-amber-900" },
  dormant: { label: "Dormant", tone: "bg-slate-200 text-slate-700" },
  unused: { label: "Not used yet", tone: "bg-sky-100 text-sky-800" },
};
/** Active: used in the last 7 days. Quiet: 8 to 30 days. Dormant: longer. Not used yet: nobody has done anything. */
const standingOf = (a: CustomerAccount, now: number): Standing => {
  if (!a.lastActivity) return "unused";
  const age = now - a.lastActivity.getTime();
  return age <= 7 * DAY ? "active" : age <= 30 * DAY ? "quiet" : "dormant";
};
const ago = (d: Date | null, now: number): string => {
  if (!d) return "never";
  const mins = Math.max(0, Math.round((now - d.getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`;
};
/** A facility that is sample, practice, or test data inside a real business. */
const isPracticeFacility = (f: Facility) => /^(demo|sample|practice|test)/i.test(f.licenseNumber) || /\b(demo|sample|practice|test)\b/i.test(f.name);

export default async function SupportConsolePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  if (session.support || !(await isPlatformAdmin(session.userId))) redirect("/dashboard");
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const [accounts, admins, visits, jobs] = await Promise.all([
    listCustomerAccounts(),
    listSupportAdmins(),
    recentSupportVisits(15),
    Promise.all([jobStatus("sync"), jobStatus("watch"), jobStatus("brief")]),
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
  const now = currentTime();
  const customers = shown.filter((a) => !a.isDemo);
  const demos = shown.filter((a) => a.isDemo);
  const counts = { active: 0, quiet: 0, dormant: 0, unused: 0 } satisfies Record<Standing, number>;
  for (const a of real) counts[standingOf(a, now)]++;

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
          {customers.length > 0 ? (
            <section aria-label="Customers" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-950">
                  Customers <span className="text-sm font-semibold text-slate-500">{customers.length}</span>
                </h2>
                <p className="flex flex-wrap gap-1.5 text-xs font-semibold" aria-label="Customers by activity">
                  {(Object.keys(STANDING) as Standing[]).map((k) => (
                    <span key={k} className={`rounded-full px-2 py-0.5 ${STANDING[k].tone}`}>
                      {counts[k]} {STANDING[k].label.toLowerCase()}
                    </span>
                  ))}
                </p>
              </div>
              <ul className="space-y-2">
                {customers.map((a) => (
                  <AccountRow key={a.id} a={a} now={now} q={q} open={Boolean(q) || customers.length <= 3} ownOrgId={session.orgId} />
                ))}
              </ul>
            </section>
          ) : null}
          {demos.length > 0 ? (
            <details open={Boolean(q)} className="group rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-bold text-slate-950">
                <span>
                  Demo accounts <span className="font-semibold text-slate-500">{demos.length}</span>
                  <span className="block text-xs font-normal text-slate-500">Made automatically by the live demo. Nothing here is a customer.</span>
                </span>
                <span className="text-sm font-semibold text-brand-700 group-open:hidden">Show</span>
                <span className="hidden text-sm font-semibold text-brand-700 group-open:inline">Hide</span>
              </summary>
              <ul className="space-y-2 border-t border-slate-100 p-3">
                {demos.map((a) => (
                  <AccountRow key={a.id} a={a} now={now} q={q} open={Boolean(q)} ownOrgId={session.orgId} />
                ))}
              </ul>
            </details>
          ) : null}
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
                  {j.job === "brief" && j.lastRun?.summary ? (
                    <p className="text-slate-600">
                      Last result: {String(j.lastRun.summary.people ?? 0)} signed up, {String(j.lastRun.summary.sent ?? 0)} sent, {String(j.lastRun.summary.skipped ?? 0)} skipped,{" "}
                      {String(j.lastRun.summary.failed ?? 0)} failed.{j.lastRun.summary.firstError ? ` ${String(j.lastRun.summary.firstError)}` : ""}
                    </p>
                  ) : null}
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

function AccountRow({ a, now, q, open, ownOrgId }: { a: CustomerAccount; now: number; q: string; open: boolean; ownOrgId: string }) {
  const standing = STANDING[standingOf(a, now)];
  return (
    <li>
      <details open={open} className="group rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <span className={`w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-bold ${standing.tone}`}>{standing.label}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold text-slate-950">
              {a.name}
              {a.isDemo ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">live demo</span> : null}
              {!a.isDemo && (a.access === "suspended" || a.access === "none") ? (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${ACCESS[a.access].tone}`}>{ACCESS[a.access].label}</span>
              ) : null}
              {a.access === "listed" ? <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${ACCESS.listed.tone}`}>Your business</span> : null}
            </span>
            <span className="block truncate text-xs text-slate-500">{a.owners.length ? a.owners.join(", ") : "No active owner"}</span>
          </span>
          <span className="shrink-0 text-right text-xs text-slate-600">
            <span className="block font-semibold text-slate-800">{ago(a.lastActivity, now)}</span>
            {a.users} user{a.users === 1 ? "" : "s"} · {a.packages.toLocaleString("en-US")} package{a.packages === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="space-y-3 border-t border-slate-100 p-4">
          <p className="text-xs text-slate-500">
            Joined {when(a.createdAt)} · last activity {when(a.lastActivity)}
          </p>
          {a.isDemo ? null : (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm" data-testid={`access-${a.id}`}>
              <p className="text-xs text-slate-600">{ACCESS[a.access].note}</p>
              {a.access === "suspended" || a.access === "none" ? (
                <ActionForm action={businessAccessAction} submitLabel={a.access === "suspended" ? "Restore access" : "Give access"} quiet>
                  <input type="hidden" name="orgId" value={a.id} />
                  <input type="hidden" name="access" value="approve" />
                </ActionForm>
              ) : a.id !== ownOrgId ? (
                <Disclosure title="Suspend access">
                  <ActionForm action={businessAccessAction} submitLabel="Suspend" quiet className="space-y-2 p-3 pt-0">
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
          {a.facilities.length === 0 ? (
            <p className="text-sm text-slate-500">No facilities yet, so there is nothing to open.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200" aria-label={`Facilities of ${a.name}`}>
              {a.facilities.map((f) => (
                <li key={f.id} className={`grid gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-center ${facilityMatches(f, q) ? "bg-amber-50" : ""}`}>
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-900">
                      {f.name}
                      {isPracticeFacility(f) ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-700">practice / test</span> : null}
                    </span>
                    <span className="block text-sm text-slate-600">
                      {stateName(f.state)} · {f.licenseType.toLowerCase()} · license {f.licenseNumber}
                    </span>
                  </span>
                  <ActionForm action={openAccountAction} submitLabel="Open" className="flex items-center gap-2">
                    <input type="hidden" name="orgId" value={a.id} />
                    <input type="hidden" name="facilityId" value={f.id} />
                    <input
                      name="reason"
                      required
                      maxLength={300}
                      placeholder="Why? e.g. Label printing help"
                      aria-label={`Reason for opening ${f.name}`}
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}
