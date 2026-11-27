import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { itemCategories } from "@/db/schema";
import { db } from "@/lib/db";
import { emailConfigured } from "@/lib/email";
import { listCampaigns, segmentLabelFor } from "@/lib/marketing";
import { requirePagePermission } from "@/lib/session";
import { smsConfigured } from "@/lib/sms";
import { facilityZone } from "@/lib/time";
import { campaignCreateAction } from "../actions";
import { CampaignFields } from "./campaign-fields";

export const metadata = { title: "Campaigns · Leaf2Sale" };

export default async function CampaignsPage() {
  const session = await requirePagePermission("pos.manage");
  const [campaigns, categories, zone] = await Promise.all([
    listCampaigns(session.orgId),
    db.select({ id: itemCategories.id, name: itemCategories.name }).from(itemCategories).where(eq(itemCategories.orgId, session.orgId)).orderBy(asc(itemCategories.name)),
    facilityZone(session.facilityId),
  ]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }) : "");
  return (
    <>
      <PageHeader title="Campaigns" subtitle="Send one message to a group of shoppers. Every message is checked against your rules and goes only to people who agreed." />
      {!emailConfigured() || !smsConfigured() ? (
        <p className="mb-5 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          {!emailConfigured() ? "Email isn't connected yet (needs RESEND_API_KEY and MAIL_FROM). " : ""}
          {!smsConfigured() ? "Texting isn't connected yet: it needs your own cannabis-approved texting provider (SMS_WEBHOOK_URL and SMS_WEBHOOK_SECRET). " : ""}
          You can still write and check drafts.
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Your campaigns">
            {campaigns.length === 0 ? (
              <p className="text-sm text-slate-600">No campaigns yet. Write your first one on the right.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm" data-testid="campaigns">
                {campaigns.map((c) => (
                  <li key={c.id}>
                    <Link href={`/marketing/campaigns/${c.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="font-semibold text-slate-900">{c.name}</span>
                        <span className="block text-slate-600">
                          {c.channel === "SMS" ? "Text" : "Email"} · {segmentLabelFor(c.segment, names)}
                        </span>
                      </span>
                      <span className="text-right text-slate-700">
                        {c.status === "SENT" ? `Sent ${day(c.sentAt)} to ${c.recipientCount}` : "Draft"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="New campaign">
          <ActionForm action={campaignCreateAction} submitLabel="Save draft and check it">
            <CampaignFields categories={categories} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
