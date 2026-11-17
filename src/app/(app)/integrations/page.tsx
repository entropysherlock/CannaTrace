import { Info } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { apiKeys, webhookDeliveries, webhooks } from "@/db/schema";
import { db } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/integrations";
import { requirePagePermission } from "@/lib/session";
import { createKeyAction, createWebhookAction, revokeKeyAction, toggleWebhookAction } from "./actions";

const ENDPOINTS = [
  ["GET", "/api/v1/packages", "Packages at the key's facility. Filters: status, limit (up to 500), offset."],
  ["GET", "/api/v1/packages/{tag}", "One package with its last 100 inventory changes."],
  ["POST", "/api/v1/packages/{tag}/adjust", 'Needs a write key. Body: {"newQuantity": "98.5", "reasonCode": "DRYING", "note": "optional"}'],
  ["GET", "/api/v1/items", "Every item in the organization."],
  ["GET", "/api/v1/sales", "Completed and voided retail sales. Filters: since (YYYY-MM-DD), limit, offset."],
  ["GET", "/api/v1/orders", "Wholesale orders with manifest and invoice numbers. Filters: limit, offset."],
];

export default async function IntegrationsPage() {
  const session = await requirePagePermission("integrations.manage");
  const scope = (t: typeof apiKeys | typeof webhooks) => and(eq(t.orgId, session.orgId), eq(t.facilityId, session.facilityId));
  const [keys, hooks, deliveries] = await Promise.all([
    db.select().from(apiKeys).where(scope(apiKeys)).orderBy(desc(apiKeys.createdAt)),
    db.select().from(webhooks).where(scope(webhooks)).orderBy(desc(webhooks.createdAt)),
    db
      .select({ d: webhookDeliveries, url: webhooks.url })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(scope(webhooks))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(20),
  ]);

  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect accounting, ecommerce, or your own tools to this facility." />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="API keys">
            {keys.length === 0 ? (
              <p className="text-sm text-slate-600">No keys yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className={k.revokedAt ? "opacity-50" : ""}>
                      <p className="font-medium text-slate-900">
                        {k.name} <span className="font-mono text-slate-500">{k.prefix}…</span>
                      </p>
                      <p className="text-slate-600">
                        {k.canWrite ? "read and write" : "read only"} · made by {k.createdByName} ·{" "}
                        {k.revokedAt ? `revoked ${k.revokedAt.toLocaleDateString("en-US")}` : k.lastUsedAt ? `last used ${k.lastUsedAt.toLocaleString("en-US")}` : "never used"}
                      </p>
                    </div>
                    {k.revokedAt ? null : (
                      <ActionForm action={revokeKeyAction} submitLabel="Revoke" quiet className="flex flex-col items-end gap-1">
                        <input type="hidden" name="keyId" value={k.id} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Create an API key">
            <ActionForm action={createKeyAction} submitLabel="Create key">
              <Field label="What will use it">
                <input name="name" required maxLength={60} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="canWrite" className="h-5 w-5 accent-brand-700" />
                Allow changes (inventory adjustments), not just reading
              </label>
              <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>The key works only for this facility. Changes it makes appear in the audit trail under the key&apos;s name.</span></p>
            </ActionForm>
          </Card>
          <Card title="Using the API">
            <p className="text-sm text-slate-600">
              Send the key on every request as <code className="rounded bg-slate-100 px-1">Authorization: Bearer ct_…</code>. Responses are JSON. Quantities
              are strings so no precision is lost. Errors come back as <code className="rounded bg-slate-100 px-1">{`{"error": "..."}`}</code> with a plain-English
              message.
            </p>
            <ul className="mt-3 space-y-3 text-sm">
              {ENDPOINTS.map(([method, path, note]) => (
                <li key={path + method}>
                  <p className="font-mono">
                    <span className={`mr-2 font-semibold ${method === "GET" ? "text-sky-700" : "text-fuchsia-700"}`}>{method}</span>
                    {path}
                  </p>
                  <p className="text-slate-600">{note}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Webhooks">
            {hooks.length === 0 ? (
              <p className="text-sm text-slate-600">No webhooks yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {hooks.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className={`min-w-0 ${h.active ? "" : "opacity-50"}`}>
                      <p className="break-all font-mono text-slate-900">{h.url}</p>
                      <p className="text-slate-600">{h.events.map((e) => e.replaceAll("_", " ").toLowerCase()).join(", ")}</p>
                    </div>
                    <ActionForm action={toggleWebhookAction} submitLabel={h.active ? "Turn off" : "Turn on"} quiet className="flex flex-col items-end gap-1">
                      <input type="hidden" name="webhookId" value={h.id} />
                      <input type="hidden" name="active" value={h.active ? "false" : "true"} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Add a webhook">
            <ActionForm action={createWebhookAction} submitLabel="Add webhook">
              <Field label="Address to send to" hint="Must start with https:// and be on the public internet.">
                <input name="url" type="url" required placeholder="https://" className={inputClass} />
              </Field>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-slate-700">Send when</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label key={event} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="events" value={event} className="h-4 w-4 accent-brand-700" />
                      {event.replaceAll("_", " ").toLowerCase()}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-sm text-slate-600">
                Each request is a JSON POST signed in the <code className="rounded bg-slate-100 px-1">CannaTrace-Signature</code> header as{" "}
                <code className="rounded bg-slate-100 px-1">t=&lt;seconds&gt;,v1=&lt;HMAC-SHA256 of &quot;t.body&quot;&gt;</code>. Failed deliveries are retried for
                about 15 hours.
              </p>
            </ActionForm>
          </Card>
          <Card title="Recent deliveries">
            {deliveries.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing sent yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {deliveries.map(({ d, url }) => (
                  <li key={d.id} className="py-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium text-slate-900">{d.event.replaceAll("_", " ").toLowerCase()}</span>
                      <span
                        className={`font-semibold ${d.status === "DELIVERED" ? "text-brand-700" : d.status === "FAILED" ? "text-red-700" : "text-amber-700"}`}
                      >
                        {d.status.toLowerCase()}
                        {d.attempts > 1 ? ` after ${d.attempts} tries` : ""}
                      </span>
                    </div>
                    <p className="break-all text-slate-500">
                      {url} · {d.createdAt.toLocaleString("en-US")}
                      {d.lastResponse && d.status !== "DELIVERED" ? ` · ${d.lastResponse}` : ""}
                    </p>
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
