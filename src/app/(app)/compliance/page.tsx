import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, ScrollBox, inputClass } from "@/components/ui";
import { facilities, syncEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { jobStatus } from "@/lib/job-runs";
import { ADAPTERS } from "@/lib/sync";
import { SYSTEM_LABELS, explainError, type SystemName } from "@/lib/sync-math";
import { resolveAction, retryAction, sendNowAction, systemAction } from "./actions";
import { facilityZone } from "@/lib/time";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  SENT: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-800",
  MANUAL: "bg-sky-100 text-sky-800",
  RESOLVED: "bg-slate-200 text-slate-700",
};
const STATUS_TEXT: Record<string, string> = {
  PENDING: "waiting",
  SENT: "sent",
  FAILED: "failed",
  MANUAL: "enter by hand",
  RESOLVED: "handled",
};

export default async function CompliancePage() {
  const session = await requirePagePermission("compliance.view");
  const zone = await facilityZone(session.facilityId);
  const [facility] = await db.select().from(facilities).where(eq(facilities.id, session.facilityId));
  const scope = and(eq(syncEvents.orgId, session.orgId), eq(syncEvents.facilityId, session.facilityId));
  const [counts, attention, recent] = await Promise.all([
    db
      .select({ status: syncEvents.status, count: sql<number>`count(*)::int` })
      .from(syncEvents)
      .where(and(scope, sql`(${syncEvents.status} <> 'SENT' or ${syncEvents.finishedAt} >= now() - interval '1 day')`))
      .groupBy(syncEvents.status),
    db
      .select()
      .from(syncEvents)
      .where(and(scope, inArray(syncEvents.status, ["FAILED", "MANUAL"])))
      .orderBy(syncEvents.seq)
      .limit(50),
    db.select().from(syncEvents).where(scope).orderBy(desc(syncEvents.seq)).limit(40),
  ]);
  const count = (status: string) => counts.find((c) => c.status === status)?.count ?? 0;
  const failed = attention.filter((e) => e.status === "FAILED");
  const manual = attention.filter((e) => e.status === "MANUAL");
  const system = facility.trackTraceSystem as SystemName;
  const connection = ADAPTERS[system].status();
  const canManage = can(session, "compliance.manage");
  const oldestWaiting = recent.filter((e) => e.status === "PENDING").at(-1);
  // Practice mode marks records done but sends nothing: never call them "sent".
  const practice = system === "MOCK";
  const job = await jobStatus("sync");
  const when = (d: Date) => d.toLocaleString("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" });
  const statusText = (status: string, eventSystem: string) => (status === "SENT" && eventSystem === "MOCK" ? "practice, not sent" : STATUS_TEXT[status]);
  const statusStyle = (status: string, eventSystem: string) => (status === "SENT" && eventSystem === "MOCK" ? "bg-slate-100 text-slate-700" : STATUS_STYLE[status]);

  const tiles = [
    { label: "Waiting to send", value: count("PENDING"), tone: count("PENDING") ? "text-amber-700" : "text-slate-900" },
    { label: "Failed", value: count("FAILED"), tone: count("FAILED") ? "text-red-700" : "text-slate-900" },
    { label: "Enter by hand", value: count("MANUAL"), tone: count("MANUAL") ? "text-sky-700" : "text-slate-900" },
    { label: practice ? "Practice records in the last day (not sent)" : "Sent in the last day", value: count("SENT"), tone: "text-slate-900" },
  ];

  return (
    <>
      <PageHeader title="State reporting" subtitle={`${facility.name} reports to ${SYSTEM_LABELS[system]}`} />

      {practice ? (
        <p role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950" data-testid="practice-notice">
          Practice mode: nothing is sent to the state. Records are marked done here so you can try CannaTrace, but you still need to report everything in
          your state system yourself.
        </p>
      ) : null}

      {failed.length ? (
        <p role="status" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-900">
          {failed.length === 1 ? "A record failed" : `${failed.length} records failed`} to reach the state. Records saved after it are held back until it is fixed, because the state needs them in order.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">{tile.label}</p>
            <p className={`mt-1 text-3xl font-bold ${tile.tone}`}>{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {failed.map((event) => {
            const help = explainError(event.lastErrorCode, event.system as SystemName);
            return (
              <section key={event.id} className="rounded-lg border border-red-200 bg-white p-4 shadow-sm sm:p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Failed · tried {event.attempts} time{event.attempts === 1 ? "" : "s"}</p>
                <h2 className="mt-1 text-base font-semibold text-slate-900">{help.title}</h2>
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-medium">Record:</span> {event.summary} ({event.createdAt.toLocaleString("en-US", { timeZone: zone })})
                </p>
                <p className="mt-2 text-sm text-slate-700">
                  <span className="font-medium">What it means:</span> {help.meaning}
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-medium">What to do:</span> {help.fix}
                </p>
                {event.lastErrorDetail ? (
                  <p className="mt-2 rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">{event.lastErrorDetail}</p>
                ) : null}
                {canManage ? (
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    <ActionForm action={retryAction} submitLabel="Retry now" className="space-y-2">
                      <input type="hidden" name="eventId" value={event.id} />
                    </ActionForm>
                    <ActionForm action={resolveAction} submitLabel="Mark handled" quiet className="flex flex-1 flex-wrap items-start gap-2">
                      <input type="hidden" name="eventId" value={event.id} />
                      <input name="note" required aria-label="What was done" placeholder="What was done, e.g. entered by hand" className={`${inputClass} min-w-48 flex-1`} />
                    </ActionForm>
                  </div>
                ) : null}
              </section>
            );
          })}

          <Card title={`Enter by hand (${manual.length})`}>
            {manual.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing needs entering by hand.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-600">{manual[0].lastErrorDetail}</p>
                <ul className="divide-y divide-slate-100 text-sm">
                  {manual.map((event) => (
                    <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{event.summary}</p>
                        <p className="text-slate-500">
                          {event.createdAt.toLocaleString("en-US", { timeZone: zone })} · by {String((event.payload as { by?: string }).by ?? "")}
                        </p>
                      </div>
                      {canManage ? (
                        <ActionForm action={resolveAction} submitLabel="Entered" quiet className="flex items-start gap-2">
                          <input type="hidden" name="eventId" value={event.id} />
                          <input type="hidden" name="note" value={`Entered in ${SYSTEM_LABELS[event.system as SystemName]} by hand`} />
                        </ActionForm>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="Recent records">
            {recent.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing has been recorded at this facility yet.</p>
            ) : (
              <ScrollBox label="Recent records" size="lg">
              <ul className="divide-y divide-slate-100 text-sm">
                {recent.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 text-slate-900">{event.summary}</span>
                    <span className="flex items-center gap-2 text-slate-500">
                      {event.createdAt.toLocaleTimeString("en-US", { timeZone: zone })}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyle(event.status, event.system)}`}>{statusText(event.status, event.system)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              </ScrollBox>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Connection">
            <p className="text-sm font-medium text-slate-900">{SYSTEM_LABELS[system]}</p>
            <p className={`mt-1 text-sm ${connection.ready ? "text-slate-600" : "font-medium text-red-700"}`}>{connection.note}</p>
            <p className="mt-2 text-sm text-slate-600">
              Sent automatically:{" "}
              {ADAPTERS[system].supported.includes("*")
                ? "nothing (practice mode)"
                : ADAPTERS[system].supported.length
                  ? ADAPTERS[system].supported.map((t) => t.replaceAll("_", " ").toLowerCase()).join(", ")
                  : "nothing yet"}
              .{practice ? "" : " Everything else is listed under Enter by hand."}
            </p>
            {/* The real schedule, and when it last ran: never imply a send that hasn't happened. */}
            <div className="mt-2 text-sm text-slate-600" data-testid="sync-schedule">
              <p>
                Automatic sending runs {job.schedule}.{" "}
                {job.lastRun
                  ? `Last run: ${when(job.lastRun.startedAt)}${job.lastRun.status === "OK" ? "" : job.lastRun.status === "FAILED" ? " (failed)" : " (still running or cut off)"}.`
                  : "It hasn't run yet."}
              </p>
              {job.failing || job.late ? (
                <p className="mt-1 font-medium text-red-700" role="status">
                  {job.failing ? "The last automatic run didn't finish." : "Automatic sending hasn't run on time."} Use Send now, and let CannaTrace support know.
                </p>
              ) : null}
            </div>
            {oldestWaiting ? (
              <p className="mt-2 text-sm text-slate-600">Oldest waiting record: {oldestWaiting.createdAt.toLocaleString("en-US", { timeZone: zone })}</p>
            ) : null}
            {canManage ? (
              <div className="mt-4">
                <ActionForm action={sendNowAction} submitLabel="Send now">
                  <p className="text-sm text-slate-600">Sends everything that is due at this facility right now, without waiting for the next automatic run.</p>
                </ActionForm>
              </div>
            ) : null}
          </Card>
          {canManage ? (
            <Card title="State system for this facility">
              <ActionForm action={systemAction} submitLabel="Save">
                <Field label="Reports go to" hint="Changing this affects records saved from now on. Failed records use the new choice when retried.">
                  <select name="system" defaultValue={system} className={inputClass}>
                    {(Object.keys(SYSTEM_LABELS) as SystemName[]).map((key) => (
                      <option key={key} value={key}>
                        {SYSTEM_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
