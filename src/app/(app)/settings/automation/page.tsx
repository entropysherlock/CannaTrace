import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { getAutomation, recentActivity } from "@/lib/automation";
import { AUTOMATION_KINDS, DEFAULT_CAP } from "@/lib/automation-math";
import { requirePagePermission } from "@/lib/session";
import { automationModeAction, automationPauseAction } from "./actions";

export const metadata = { title: "Automation · Leaf2Sale" };
export const instant = false;

const OUTCOME: Record<string, { label: string; tone: string }> = {
  DONE: { label: "Done", tone: "bg-emerald-100 text-emerald-800" },
  PROPOSED: { label: "Waiting for approval", tone: "bg-sky-100 text-sky-800" },
  BLOCKED: { label: "Blocked", tone: "bg-slate-200 text-slate-700" },
  FAILED: { label: "Failed", tone: "bg-red-100 text-red-800" },
};
const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function AutomationPage() {
  const session = await requirePagePermission("settings.manage");
  const [state, activity] = await Promise.all([getAutomation(session.orgId), recentActivity(session.orgId)]);
  return (
    <div className="space-y-5">
      <PageHeader title="Automation" subtitle="Choose what Leaf2Sale may do on its own, and stop everything with one switch." />
      <Card title={state.paused ? "Automation is paused" : "Automation is on"}>
        <div className="space-y-3 text-sm text-slate-700">
          {state.paused ? (
            <p role="status" className="rounded-lg bg-amber-50 p-3 font-semibold text-amber-900">
              Paused by {state.pausedBy ?? "a manager"}
              {state.pausedAt ? ` on ${when(state.pausedAt)}` : ""}
              {state.pauseReason ? `: ${state.pauseReason}` : ""}. Nothing runs on its own until you resume.
            </p>
          ) : (
            <p>Pausing stops every automatic action right away, whatever the settings below say.</p>
          )}
          <ActionForm action={automationPauseAction} submitLabel={state.paused ? "Resume automation" : "Pause all automation"} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="paused" value={state.paused ? "false" : "true"} />
            {!state.paused ? (
              <Field label="Why (optional)">
                <input name="reason" maxLength={200} className={inputClass} />
              </Field>
            ) : null}
          </ActionForm>
        </div>
      </Card>
      <Card title="What may run on its own">
        <p className="mb-4 text-sm text-slate-600">
          <strong>Off:</strong> never. <strong>Ask me:</strong> it prepares the work and waits for a person to approve. <strong>Auto:</strong> it just does it and logs it below. Anything that changes stock, messages customers or runs production can only be Ask me for now.
        </p>
        <ul className="divide-y divide-slate-100">
          {AUTOMATION_KINDS.map((k) => {
            const s = state.settings.get(k.kind);
            return (
              <li key={k.kind} className="py-3" data-testid={`automation-${k.kind}`}>
                <p className="font-semibold text-slate-900">{k.label}</p>
                <p className="mb-2 text-sm text-slate-600">{k.detail}</p>
                <ActionForm action={automationModeAction} submitLabel="Save" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="kind" value={k.kind} />
                  <Field label="Setting">
                    <select name="mode" defaultValue={s?.mode ?? "OFF"} className={inputClass}>
                      <option value="OFF">Off</option>
                      <option value="ASK">Ask me</option>
                      {k.autoAllowed ? <option value="AUTO">Auto</option> : null}
                    </select>
                  </Field>
                  <Field label="Most per hour">
                    <input name="hourlyCap" inputMode="numeric" defaultValue={s?.hourlyCap ?? DEFAULT_CAP} className={`${inputClass} w-24`} />
                  </Field>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="What it has done">
        {activity.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing yet. When something runs on its own, or waits for approval, it shows up here.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="automation-activity">
            {activity.map((a) => {
              const o = OUTCOME[a.outcome] ?? { label: a.outcome, tone: "bg-slate-100 text-slate-700" };
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{a.summary}</span>
                    <span className="block text-slate-500">
                      {when(a.createdAt)}
                      {a.trigger ? ` · ${a.trigger}` : ""}
                      {a.requestedBy ? ` · asked by ${a.requestedBy}` : ""}
                    </span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${o.tone}`}>{o.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
