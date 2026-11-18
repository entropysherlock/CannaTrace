import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { Disclosure } from "@/components/disclosure";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { CONSOLE_LINKS, getConnection, usageSummary } from "@/lib/ai/connection";
import { requirePagePermission } from "@/lib/session";
import { checkKeyAction, connectKeyAction, disconnectAction, limitsAction, modelAction } from "./actions";
import { facilityZone } from "@/lib/time";

export const metadata = { title: "Tally AI · CannaTrace" };

const when = (d: Date | null, zone: string) =>
  d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone }) : "never";
const n = (v: number) => v.toLocaleString("en-US");

const STATUS: Record<string, { label: string; tone: "ok" | "bad" }> = {
  CONNECTED: { label: "Connected", tone: "ok" },
  INVALID_KEY: { label: "Key not accepted", tone: "bad" },
  NO_CREDIT: { label: "Out of credits", tone: "bad" },
  RATE_LIMITED: { label: "Rate limited", tone: "bad" },
  ERROR: { label: "Problem reaching Claude", tone: "bad" },
};

function modelBlurb(id: string): string {
  if (/haiku/.test(id)) return "fastest and lowest cost";
  if (/sonnet/.test(id)) return "recommended: smart and affordable";
  if (/opus/.test(id)) return "most capable, costs the most";
  return "";
}

function ConsoleLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 underline hover:no-underline">
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">(opens the Claude Console in a new tab)</span>
    </a>
  );
}

function SetupSteps() {
  return (
    <ol className="space-y-4 text-sm text-slate-700">
      <li className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">1</span>
        <p>
          <strong className="text-slate-900">Open the Claude Console</strong> and sign in or create an account for your business. This is separate from a
          claude.ai chat subscription. <ConsoleLink href={CONSOLE_LINKS.home}>Open Claude Console</ConsoleLink>
        </p>
      </li>
      <li className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">2</span>
        <p>
          <strong className="text-slate-900">Buy credits</strong> under Billing. Claude is prepaid: Tally can&apos;t answer until the account has credits. Turning on
          auto-reload and setting a monthly spend limit there is a good idea. <ConsoleLink href={CONSOLE_LINKS.billing}>Go to Billing</ConsoleLink>
        </p>
      </li>
      <li className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">3</span>
        <p>
          <strong className="text-slate-900">Create an API key</strong> named &quot;CannaTrace Tally&quot; and copy it. It starts with <code className="rounded bg-slate-100 px-1">sk-ant-</code>{" "}
          and is shown only once. <ConsoleLink href={CONSOLE_LINKS.keys}>Go to API keys</ConsoleLink>
        </p>
      </li>
      <li className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">4</span>
        <p>
          <strong className="text-slate-900">Paste it below and press Connect.</strong> CannaTrace checks it with Anthropic before saving. Everyone on your team then
          shares it, within the limits you set here.
        </p>
      </li>
    </ol>
  );
}

function ConnectForm({ label, replacing }: { label: string; replacing: boolean }) {
  return (
    <ActionForm action={connectKeyAction} submitLabel={label}>
      <Field label={replacing ? "New Claude API key" : "Claude API key"}>
        <input
          name="apiKey"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          className={`${inputClass} font-mono`}
        />
      </Field>
      <p className="flex gap-2 text-xs text-slate-600">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
        <span>
          The key is encrypted before it is stored. After you save it, nobody can see it again, including your team and CannaTrace. Only the last four characters
          are shown so you can tell keys apart.{replacing ? " The old key stops being used the moment the new one is saved." : ""}
        </span>
      </p>
    </ActionForm>
  );
}

export default async function TallyAiSettingsPage() {
  const session = await requirePagePermission("ai.manage");
  const zone = await facilityZone(session.facilityId);
  const [conn, usage] = await Promise.all([getConnection(session.orgId), usageSummary(session.orgId)]);
  const status = conn.status ? (STATUS[conn.status] ?? STATUS.ERROR) : null;

  return (
    <>
      <PageHeader
        title="Tally AI"
        subtitle="Tally runs on your business's own Claude account. You pay Anthropic directly for what your team uses, and you decide the limits."
      />
      {!conn.storageReady ? (
        <p role="alert" className="mb-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          Secure key storage isn&apos;t set up on this CannaTrace server yet, so a key can&apos;t be saved. CannaTrace support needs to finish setup first.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="AI provider connection">
            {!conn.connected ? (
              <div className="space-y-5">
                <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <KeyRound className="h-5 w-5 text-slate-400" aria-hidden="true" /> Not connected
                </p>
                <SetupSteps />
                <ConnectForm label="Connect" replacing={false} />
              </div>
            ) : (
              <div className="space-y-4">
                <div
                  className={`flex items-start gap-3 rounded-xl p-4 ${status?.tone === "ok" ? "bg-brand-50 text-brand-950" : "bg-red-50 text-red-950"}`}
                  role={status?.tone === "ok" ? "status" : "alert"}
                >
                  {status?.tone === "ok" ? (
                    <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-700" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 shrink-0 text-red-700" aria-hidden="true" />
                  )}
                  <div>
                    <p className="text-base font-bold">{status?.label}</p>
                    {conn.statusMessage ? <p className="mt-1 text-sm">{conn.statusMessage}</p> : null}
                    {conn.status === "NO_CREDIT" ? (
                      <p className="mt-2 text-sm">
                        <ConsoleLink href={CONSOLE_LINKS.billing}>Add credits in the Claude Console</ConsoleLink>
                      </p>
                    ) : null}
                    {!conn.enabled ? <p className="mt-1 text-sm font-semibold">Tally is paused for your team (see Limits).</p> : null}
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-slate-600">Key</dt>
                  <dd className="font-mono" data-testid="key-hint">
                    {conn.keyHint}
                  </dd>
                  <dt className="text-slate-600">Model</dt>
                  <dd>{conn.availableModels.find((m) => m.id === conn.model)?.name ?? conn.model}</dd>
                  <dt className="text-slate-600">Connected by</dt>
                  <dd>
                    {conn.connectedByName} · {when(conn.connectedAt, zone)}
                  </dd>
                  <dt className="text-slate-600">Last checked</dt>
                  <dd>{when(conn.checkedAt, zone)}</dd>
                </dl>
                <ActionForm action={checkKeyAction} submitLabel="Check connection" quiet>
                  <p className="text-xs text-slate-500">Asks Anthropic whether the key still works. Free: it doesn&apos;t use credits.</p>
                </ActionForm>
                <Disclosure title="Replace the key">
                  <div className="border-t border-slate-100 p-4">
                    <ConnectForm label="Replace key" replacing />
                  </div>
                </Disclosure>
                <Disclosure title="Disconnect">
                  <div className="border-t border-slate-100 p-4">
                    <ActionForm action={disconnectAction} submitLabel="Disconnect Tally" quiet>
                      <p className="text-sm text-slate-700">
                        Removes the key from CannaTrace. Tally stops answering for everyone until a key is connected again. Usage history is kept.
                      </p>
                      <Field label='Type "disconnect" to confirm'>
                        <input name="confirm" autoComplete="off" className={inputClass} />
                      </Field>
                    </ActionForm>
                  </div>
                </Disclosure>
                <Disclosure title="How to get a new key">
                  <div className="border-t border-slate-100 p-4">
                    <SetupSteps />
                  </div>
                </Disclosure>
              </div>
            )}
          </Card>

          {conn.connected && conn.availableModels.length ? (
            <Card title="Model">
              <ActionForm action={modelAction} submitLabel="Save model">
                <fieldset className="space-y-2">
                  <legend className="sr-only">Claude model</legend>
                  {conn.availableModels
                    .filter((m) => /haiku|sonnet|opus/.test(m.id))
                    .map((m) => (
                      <label key={m.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 ring-1 ring-slate-200 has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-600">
                        <input type="radio" name="model" value={m.id} defaultChecked={m.id === conn.model} className="h-4 w-4 accent-brand-700" />
                        <span className="text-sm">
                          <span className="font-semibold text-slate-900">{m.name}</span>
                          {modelBlurb(m.id) ? <span className="text-slate-600"> · {modelBlurb(m.id)}</span> : null}
                        </span>
                      </label>
                    ))}
                </fieldset>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card title="Usage">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm text-slate-600">Questions, last 24 hours</p>
                <p className="font-display text-3xl font-bold tabular-nums">{n(usage.last24h)}</p>
                <p className="text-xs text-slate-500">limit {n(conn.limits.dailyLimit)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm text-slate-600">Questions this month</p>
                <p className="font-display text-3xl font-bold tabular-nums">{n(usage.thisMonth)}</p>
                <p className="text-xs text-slate-500">limit {n(conn.limits.monthlyLimit)}</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-700">
              This month Tally sent about <strong>{n(usage.inputTokens)}</strong> tokens to Claude and got <strong>{n(usage.outputTokens)}</strong> back
              {usage.failures ? ` · ${n(usage.failures)} question${usage.failures === 1 ? "" : "s"} didn't get an answer` : ""}.
            </p>
            {usage.people.length ? (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {usage.people.map((p) => (
                  <li key={p.name} className="flex justify-between py-1.5">
                    <span>{p.name}</span>
                    <span className="tabular-nums text-slate-600">{n(p.questions)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {usage.recentProblems.length ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">Recent problems</p>
                <ul className="mt-1 space-y-0.5">
                  {usage.recentProblems.map((p, i) => (
                    <li key={i}>
                      {when(p.at, zone)} · {STATUS[p.outcome]?.label ?? p.outcome.toLowerCase()} · {p.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-slate-500">
              Token counts are an estimate of use. CannaTrace can&apos;t see your Claude credit balance or exact charges; those are in the Claude Console under{" "}
              <ConsoleLink href={CONSOLE_LINKS.usage}>Usage</ConsoleLink> and <ConsoleLink href={CONSOLE_LINKS.billing}>Billing</ConsoleLink>.
            </p>
          </Card>

          {conn.connected ? (
            <Card title="Limits">
              <ActionForm action={limitsAction} submitLabel="Save limits">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Questions per day, whole business">
                    <input name="dailyLimit" inputMode="numeric" defaultValue={conn.limits.dailyLimit} className={inputClass} />
                  </Field>
                  <Field label="Questions per month, whole business">
                    <input name="monthlyLimit" inputMode="numeric" defaultValue={conn.limits.monthlyLimit} className={inputClass} />
                  </Field>
                  <Field label="Questions per person per day">
                    <input name="perPersonDailyLimit" inputMode="numeric" defaultValue={conn.limits.perPersonDailyLimit} className={inputClass} />
                  </Field>
                  <Field label="Longest answer (tokens)" hint="About 750 words per 1,000 tokens. Lower keeps each answer cheaper.">
                    <input name="maxAnswerTokens" inputMode="numeric" defaultValue={conn.limits.maxAnswerTokens} className={inputClass} />
                  </Field>
                </div>
                <label className="flex items-center gap-3 text-sm font-medium text-slate-800">
                  <input type="checkbox" name="enabled" defaultChecked={conn.enabled} className="h-5 w-5 accent-brand-700" />
                  Tally is on for the team
                </label>
                <p className="text-xs text-slate-500">
                  A &quot;day&quot; is the last 24 hours. One question can take a few requests to Claude when Tally looks things up. For a hard spending cap, also set
                  a monthly limit in the <ConsoleLink href={CONSOLE_LINKS.limits}>Claude Console</ConsoleLink>.
                </p>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
