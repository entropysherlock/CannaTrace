import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { MERGE_FIELDS } from "@/lib/loyalty-math";
import { listAutomations } from "@/lib/marketing";
import { requirePagePermission } from "@/lib/session";
import { automationAction } from "../actions";

export const metadata = { title: "Automatic messages · Leaf2Sale" };

export default async function AutomationsPage() {
  const session = await requirePagePermission("pos.manage");
  const automations = await listAutomations(session.orgId);
  return (
    <>
      <PageHeader title="Automatic messages" subtitle="Messages that send themselves once a day when something happens. They follow the same rules as campaigns: only people who agreed, quiet hours, and the weekly limit." />
      <div className="grid gap-5 lg:grid-cols-2">
        {automations.map((a) => (
          <Card key={a.kind} title={a.label}>
            <p className="mb-3 text-sm text-slate-600">{a.when}</p>
            <ActionForm action={automationAction} submitLabel="Save">
              <input type="hidden" name="kind" value={a.kind} />
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={a.enabled} className="mt-0.5 h-5 w-5 accent-brand-700" />
                <span className="font-semibold">Turned on</span>
              </label>
              <Field label="Send as">
                <select name="channel" defaultValue={a.channel} className={inputClass}>
                  <option value="EMAIL">Email</option>
                  <option value="SMS">Text message</option>
                </select>
              </Field>
              <Field label="Subject (email only)">
                <input name="subject" defaultValue={a.subject} maxLength={120} className={inputClass} />
              </Field>
              <Field label="Message" hint={`You can use ${MERGE_FIELDS.join(", ")}.`}>
                <textarea name="body" rows={4} defaultValue={a.body} maxLength={2000} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
