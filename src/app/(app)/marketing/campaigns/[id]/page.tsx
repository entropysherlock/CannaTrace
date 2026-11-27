import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { usd } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { itemCategories } from "@/db/schema";
import { db } from "@/lib/db";
import { campaignResults, getCampaign, previewCampaign, segmentLabelFor } from "@/lib/marketing";
import { requirePagePermission } from "@/lib/session";
import { campaignDeleteAction, campaignSendAction, campaignUpdateAction } from "../../actions";
import { CampaignFields } from "../campaign-fields";

export const metadata = { title: "Campaign · Leaf2Sale" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("pos.manage");
  const { id } = await params;
  const campaign = await getCampaign(session.orgId, id);
  if (!campaign) notFound();
  const categories = await db.select({ id: itemCategories.id, name: itemCategories.name }).from(itemCategories).where(eq(itemCategories.orgId, session.orgId)).orderBy(asc(itemCategories.name));
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const sent = campaign.status === "SENT";
  const [preview, results] = await Promise.all([sent ? null : previewCampaign(session.orgId, campaign), sent ? campaignResults(session.orgId, campaign.id) : null]);
  return (
    <>
      <PageHeader title={campaign.name} subtitle={`${campaign.channel === "SMS" ? "Text" : "Email"} to ${segmentLabelFor(campaign.segment, names)} · ${sent ? "sent" : "draft"}`} />
      <p className="mb-4 text-sm">
        <Link href="/marketing/campaigns" className="font-semibold text-brand-700 hover:underline">
          ← All campaigns
        </Link>
      </p>
      {results ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="What it earned">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Sent", String(results.sent)],
                  ["Bought within 7 days", `${results.buyers} (${results.rate}%)`],
                  ["Sales", String(results.orders)],
                  ["Revenue", usd(results.revenue)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l}</p>
                    <p className="text-xl font-extrabold tabular-nums text-brand-950">{v}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-600">Counts shoppers who bought within 7 days after the message reached them. They may have come in anyway, so treat it as an upper bound.</p>
            </Card>
            {results.skipped + results.failed > 0 ? (
              <Card title="Who was left out">
                <ul className="space-y-1 text-sm">
                  {results.skipReasons.map((r) => (
                    <li key={r.reason} className="flex justify-between">
                      <span>{r.reason}</span>
                      <span className="tabular-nums">{r.n}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
          <Card title="The message">
            {campaign.subject ? <p className="mb-2 text-sm font-semibold">{campaign.subject}</p> : null}
            <p className="whitespace-pre-line text-sm text-slate-700">{campaign.body}</p>
          </Card>
        </div>
      ) : preview ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="Edit the draft">
              <ActionForm action={campaignUpdateAction} submitLabel="Save changes">
                <input type="hidden" name="campaignId" value={campaign.id} />
                <CampaignFields values={campaign} categories={categories} />
              </ActionForm>
            </Card>
            <Card title="Delete this draft">
              <ActionForm action={campaignDeleteAction} submitLabel="Delete draft" quiet>
                <input type="hidden" name="campaignId" value={campaign.id} />
              </ActionForm>
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="Message check">
              {preview.problems.length === 0 ? (
                <p className="text-sm font-semibold text-brand-800">Passes every check.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {preview.problems.map((p) => (
                    <li key={p.rule} className={`rounded-lg border-l-4 px-3 py-2 ${p.severity === "block" ? "border-red-600 bg-red-50 text-red-900" : "border-amber-500 bg-amber-50 text-amber-900"}`}>
                      <strong>{p.severity === "block" ? "Fix: " : "Consider: "}</strong>
                      {p.message}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-slate-600">This check helps with New Mexico&apos;s advertising rule (16.8.3.8 NMAC). You are still responsible for what you send.</p>
              <h3 className="mt-4 text-sm font-bold text-slate-800">As it will read</h3>
              <p className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{preview.body}</p>
            </Card>
            <Card title="Who it reaches">
              <p className="text-2xl font-extrabold tabular-nums text-brand-950">{preview.reachable}</p>
              <p className="text-sm text-slate-700">
                of {preview.audience} in this group. {preview.left.noConsent} haven&apos;t agreed to {campaign.channel === "SMS" ? "texts" : "emails"}
                {preview.left.noEmail ? `, ${preview.left.noEmail} have no email` : ""}. People already messaged {preview.settings.maxPerWeek} times this week are skipped at send time.
              </p>
            </Card>
            <Card title="Send">
              {!preview.provider ? (
                <p className="text-sm text-amber-900">{campaign.channel === "EMAIL" ? "Email isn't connected yet." : "Texting isn't connected yet."} Sending is off until it is.</p>
              ) : preview.quiet ? (
                <p className="text-sm text-amber-900">Quiet hours right now ({preview.settings.quietStart} to {preview.settings.quietEnd}). Texts can go out later.</p>
              ) : (
                <ActionForm action={campaignSendAction} submitLabel={`Send to ${preview.reachable}`}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <Field label="Type SEND to confirm" hint="A sent message can't be recalled.">
                    <input name="confirm" autoComplete="off" className={inputClass} />
                  </Field>
                </ActionForm>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
