import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { usd } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { shopperProfile } from "@/lib/loyalty";
import { segmentLabel } from "@/lib/loyalty-math";
import { formatBirthday, formatPhone } from "@/lib/rewards-math";
import { requirePagePermission } from "@/lib/session";
import { SITE_URL } from "@/lib/site";
import { facilityZone } from "@/lib/time";
import { consentAction, profileAction } from "../../actions";

export const metadata = { title: "Customer · Leaf2Sale" };

const METHOD: Record<string, string> = { REGISTER: "At the register", CARD: "On their own card page", STOP_REPLY: "Replied STOP", UNSUBSCRIBE: "Email unsubscribe link", MANAGER: "Recorded by a manager" };

export default async function CustomerProfile({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("pos.manage");
  const { id } = await params;
  const [p, zone] = await Promise.all([shopperProfile(session.orgId, id), facilityZone(session.facilityId)]);
  if (!p || !p.shopper) notFound();
  const s = p.shopper;
  const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }) : "never");
  return (
    <>
      <PageHeader
        title={p.member.firstName}
        subtitle={`${formatPhone(p.member.phone)}${p.member.birthday ? ` · birthday ${formatBirthday(p.member.birthday)}` : ""} · ${segmentLabel(s.segment)}${p.tier ? ` · ${p.tier.name}` : ""}`}
        action={
          <Link href={`/pos/rewards/${p.member.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-brand-200 bg-white px-4 text-sm font-bold text-brand-800 hover:bg-brand-50">
            Points, name and phone
          </Link>
        }
      />
      <p className="mb-4 text-sm">
        <Link href="/marketing/customers" className="font-semibold text-brand-700 hover:underline">
          ← All customers
        </Link>
      </p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Points", `${p.member.points.toLocaleString()}`, `Worth ${usd(p.pointsValue)}`],
          ["Spent, last 12 months", usd(s.spend12m), p.next ? `${usd(p.next.remaining)} to ${p.next.tier.name}` : p.tier ? "Top tier" : ""],
          ["Visits", String(s.visits), `Last bought ${day(s.lastPurchaseAt)}`],
          ["Lifetime spend", usd(s.lifetime), `Joined ${day(s.joinedAt)}`],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-brand-950">{value}</p>
            <p className="mt-1 text-xs text-slate-600">{note}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="What they buy">
            {p.categories.length === 0 ? (
              <p className="text-sm text-slate-600">No purchases yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-bold text-slate-800">Favorite categories</h3>
                  <ul className="space-y-1 text-sm">
                    {p.categories.map((c) => (
                      <li key={c.name ?? "none"} className="flex justify-between">
                        <span>{c.name ?? "Other"}</span>
                        <span className="tabular-nums text-slate-700">{usd(c.spend)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-bold text-slate-800">Favorite products</h3>
                  <ul className="space-y-1 text-sm">
                    {p.items.map((i) => (
                      <li key={i.name} className="flex justify-between gap-2">
                        <span>
                          {i.name}
                          {i.strain ? <span className="text-slate-500"> · {i.strain}</span> : null}
                        </span>
                        <span className="tabular-nums text-slate-700">{i.orders}×</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {p.usuallyBuysAs ? <p className="mt-3 text-xs text-slate-600">Usually rung up as {p.usuallyBuysAs === "MEDICAL" ? "medical" : "adult-use"}.</p> : null}
          </Card>
          <Card title="Recent purchases">
            {p.recent.length === 0 ? (
              <p className="text-sm text-slate-600">None yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {p.recent.map((r) => (
                  <li key={r.number} className="flex justify-between py-1.5">
                    <span>
                      {r.number} <span className="text-slate-500">· {day(r.at)}</span>
                    </span>
                    <span className="tabular-nums">{usd(r.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Messages we sent them">
            {p.messages.length === 0 ? (
              <p className="text-sm text-slate-600">None yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {p.messages.map((m) => (
                  <li key={m.id} className="flex justify-between py-1.5">
                    <span>
                      {m.automationKind ? m.automationKind.replaceAll("_", " ").toLowerCase() : "campaign"} · {m.channel === "SMS" ? "text" : "email"}
                    </span>
                    <span className="text-slate-600">
                      {m.status.toLowerCase()}
                      {m.reason ? ` (${m.reason})` : ""} · {day(m.sentAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Contact, tags and notes">
            <ActionForm action={profileAction} submitLabel="Save">
              <input type="hidden" name="memberId" value={p.member.id} />
              <Field label="Email" hint="Only used for marketing emails if they agree below.">
                <input name="email" type="email" defaultValue={p.member.email ?? ""} maxLength={120} autoComplete="off" className={inputClass} />
              </Field>
              <Field label="Tags" hint="Short words separated by commas, like vip, edibles, industry. Use them to find people later.">
                <input name="tags" defaultValue={p.member.tags.join(", ")} autoComplete="off" className={inputClass} />
              </Field>
              <Field label="Notes" hint="Visible to managers only. Don't record health details.">
                <textarea name="notes" defaultValue={p.member.notes ?? ""} rows={3} maxLength={1000} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
          <Card title="What they agreed to">
            {(["EMAIL", "SMS"] as const).map((channel) => (
              <div key={channel} className="mb-3 border-b border-slate-100 pb-3 last:mb-0 last:border-0 last:pb-0">
                <p className="text-sm font-semibold text-slate-900">
                  {channel === "EMAIL" ? "Marketing emails" : "Marketing texts"}: {p.consent[channel] ? <span className="text-brand-700">agreed</span> : <span className="text-slate-600">not agreed</span>}
                </p>
                <ActionForm action={consentAction} submitLabel={p.consent[channel] ? "Record that they opted out" : "Record that they agreed"} quiet={p.consent[channel]}>
                  <input type="hidden" name="memberId" value={p.member.id} />
                  <input type="hidden" name="channel" value={channel} />
                  <input type="hidden" name="agreed" value={p.consent[channel] ? "no" : "yes"} />
                </ActionForm>
              </div>
            ))}
            <p className="text-xs text-slate-600">Only record agreement they gave you directly. Every change is kept with the date and who recorded it.</p>
            {p.consentLog.length > 0 ? (
              <details className="mt-3 text-xs text-slate-700">
                <summary className="cursor-pointer font-semibold text-brand-700">Consent record</summary>
                <ul className="mt-2 space-y-1.5">
                  {p.consentLog.map((c) => (
                    <li key={c.id}>
                      <strong>{c.channel === "SMS" ? "Text" : "Email"} {c.status === "OPTED_IN" ? "agreed" : "opted out"}</strong> · {day(c.createdAt)} · {METHOD[c.method] ?? c.method}
                      {c.wording ? <span className="block text-slate-500">&ldquo;{c.wording}&rdquo;</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
          <Card title="Their card and referrals">
            <p className="text-sm text-slate-700">
              Referral code <strong className="font-mono tracking-wider">{p.member.referralCode}</strong>
              {p.referralsMade ? ` · referred ${p.referralsMade} shopper${p.referralsMade === 1 ? "" : "s"}` : ""}
              {p.referredBy ? ` · referred by ${p.referredBy}` : ""}
            </p>
            <p className="mt-2 break-all text-xs text-slate-600">
              Their private card page: <a className="font-semibold text-brand-700 underline" href={`${SITE_URL}/card/${p.member.cardToken}`} target="_blank" rel="noopener noreferrer">{`${SITE_URL}/card/${p.member.cardToken}`}</a>
            </p>
            <p className="mt-1 text-xs text-slate-500">Anyone with this link sees their points. Only share it with them.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
