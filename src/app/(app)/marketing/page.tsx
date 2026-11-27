import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { usd } from "@/components/distribution-ui";
import { loyaltyAnalytics, tierSummary } from "@/lib/loyalty";
import { SEGMENTS } from "@/lib/loyalty-math";
import { listCampaigns } from "@/lib/marketing";
import { getProgram } from "@/lib/rewards";
import { requirePagePermission } from "@/lib/session";
import { db } from "@/lib/db";

export const metadata = { title: "Marketing · Leaf2Sale" };

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-brand-950">{value}</p>
      {note ? <p className="mt-1 text-xs text-slate-600">{note}</p> : null}
    </div>
  );
}

export default async function MarketingOverview() {
  const session = await requirePagePermission("pos.manage");
  const [a, program, tiers, campaigns] = await Promise.all([loyaltyAnalytics(session.orgId), getProgram(db, session.orgId), tierSummary(session.orgId), listCampaigns(session.orgId)]);
  return (
    <>
      <PageHeader title="Marketing" subtitle="Know your shoppers, reward them, and reach them with messages that follow the rules." />
      {!program.enabled ? (
        <p className="mb-5 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Rewards are off, so shoppers aren&apos;t signing up at the register yet.{" "}
          <Link href="/pos/rewards" className="font-bold underline">
            Turn rewards on
          </Link>
          .
        </p>
      ) : null}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Members" value={a.members.toLocaleString()} note={`${a.counts.VIP + a.counts.REGULAR + a.counts.NEW} active, ${a.counts.AT_RISK + a.counts.LAPSED} slipping or gone`} />
        <Stat label="Come back rate" value={`${a.repeatRate}%`} note="Of members who bought, the share who bought more than once." />
        <Stat label="Member share of sales" value={`${a.memberShare}%`} note={`${usd(a.memberSales)} in the last 12 months. Average sale ${usd(a.avgBasketMember)}.`} />
        <Stat label="Points owed to shoppers" value={usd(a.liability)} note={`${a.pointsOut.toLocaleString()} points outstanding, at today's reward value.`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Your shoppers, by group">
            <ul className="divide-y divide-slate-100 text-sm">
              {SEGMENTS.map((s) => (
                <li key={s.key}>
                  <Link href={`/marketing/customers?segment=${s.key}`} className="grid grid-cols-[1fr_auto] gap-3 py-2.5 hover:bg-slate-50">
                    <span>
                      <span className="font-semibold text-slate-900">{s.label}</span>
                      <span className="block text-slate-600">{s.detail}</span>
                    </span>
                    <span className="text-xl font-extrabold tabular-nums text-brand-950">{a.counts[s.key].toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Do new members come back?">
            {a.cohorts.length === 0 ? (
              <p className="text-sm text-slate-600">No one has joined in the last 7 months yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1">Joined in</th>
                    <th className="py-1 text-right">Members</th>
                    <th className="py-1 text-right">Bought again</th>
                    <th className="py-1 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {a.cohorts.map((c) => (
                    <tr key={c.month} className="border-t border-slate-100">
                      <td className="py-1.5">{c.month}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.joined}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.cameBack}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{c.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Tiers">
            {tiers.length === 0 ? (
              <p className="text-sm text-slate-600">
                No tiers yet.{" "}
                <Link href="/marketing/loyalty" className="font-semibold text-brand-700 underline">
                  Add Bronze, Silver and Gold
                </Link>{" "}
                so your best shoppers earn points faster.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {tiers.map((t) => (
                  <li key={t.id} className="flex justify-between">
                    <span className="font-semibold">{t.name}</span>
                    <span className="tabular-nums text-slate-700">{t.members} shoppers</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Messages, last 30 days">
            <p className="text-sm text-slate-700">
              <strong>{a.messages30.sent}</strong> sent · {a.messages30.skipped} left out by a rule · {a.messages30.failed} failed
            </p>
          </Card>
          <Card title="Recent campaigns" action={<Link href="/marketing/campaigns" className="text-sm font-semibold text-brand-700 hover:underline">All</Link>}>
            {campaigns.length === 0 ? (
              <p className="text-sm text-slate-600">None yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {campaigns.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link href={`/marketing/campaigns/${c.id}`} className="font-semibold text-brand-700 hover:underline">
                      {c.name}
                    </Link>{" "}
                    <span className="text-slate-600">{c.status === "SENT" ? `sent to ${c.recipientCount}` : "draft"}</span>
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
