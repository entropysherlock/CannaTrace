import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { cardByToken } from "@/lib/loyalty";
import { cardConsentAction } from "./actions";

export const metadata: Metadata = { title: "My rewards card", robots: { index: false, follow: false } };
export const instant = false;

const KIND: Record<string, string> = { SIGNUP: "Welcome bonus", EARN: "Earned", REDEEM: "Used", BIRTHDAY: "Birthday bonus", ADJUST: "Adjustment", EXPIRE: "Expired", VOID: "Sale voided", RETURN: "Return", REFERRAL: "Referral bonus" };

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await cardByToken(token);
  if (!c) notFound();
  const money = (v: string) => `$${Number(v).toFixed(2)}`;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-md space-y-4 px-5 py-8">
        <section className="rounded-2xl bg-brand-900 p-6 text-white shadow-lg">
          <p className="text-sm font-semibold text-brand-100">{c.shop}</p>
          <p className="mt-4 text-5xl font-extrabold tabular-nums">{c.member.points.toLocaleString()}</p>
          <p className="text-sm text-brand-100">points{c.programOn ? ` · worth ${money(c.pointsValue)} off` : ""}</p>
          <p className="mt-5 text-lg font-bold">{c.member.firstName}</p>
          <p className="text-sm text-brand-100">{c.tier ? `${c.tier.name} member` : "Rewards member"}</p>
          {c.next ? <p className="mt-1 text-xs text-brand-100">Spend {money(c.next.remaining)} more in the next year to reach {c.next.tier.name}.</p> : null}
        </section>
        <p className="text-center text-sm text-slate-600">Show this card, or just give your phone number, at the counter.</p>
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-bold text-slate-900">Refer a friend</h2>
          <p className="mt-1 text-sm text-slate-700">
            Your code: <strong className="font-mono text-lg tracking-widest">{c.member.referralCode}</strong>
          </p>
          {c.referralBonus > 0 ? <p className="mt-1 text-xs text-slate-600">Tell a friend to give this code when they join. When they make their first purchase you get {c.referralBonus} points.</p> : null}
        </section>
        {c.menuSlug ? (
          <a href={`/menu/${c.menuSlug}`} className="block rounded-xl bg-brand-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-brand-700">
            See the menu and reserve for pickup
          </a>
        ) : null}
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-bold text-slate-900">Recent activity</h2>
          {c.history.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">Nothing yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {c.history.map((h) => (
                <li key={h.id} className="flex justify-between py-1.5">
                  <span>{KIND[h.kind] ?? h.kind}</span>
                  <span className={`font-semibold tabular-nums ${h.points < 0 ? "text-slate-600" : "text-brand-700"}`}>{h.points > 0 ? `+${h.points}` : h.points}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-bold text-slate-900">Messages from {c.shop}</h2>
          {(["EMAIL", "SMS"] as const).map((channel) => (
            <div key={channel} className="mt-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              <p className="text-sm text-slate-800">
                {channel === "EMAIL" ? "Emails" : "Text messages"}: <strong>{c.consent[channel] ? "on" : "off"}</strong>
              </p>
              {channel === "EMAIL" && !c.member.email && !c.consent.EMAIL ? (
                <p className="text-xs text-slate-600">Ask the store to add your email if you want these.</p>
              ) : (
                <ActionForm action={cardConsentAction} submitLabel={c.consent[channel] ? "Turn off" : "Turn on"} quiet={c.consent[channel]}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="channel" value={channel} />
                  <input type="hidden" name="agreed" value={c.consent[channel] ? "no" : "yes"} />
                </ActionForm>
              )}
            </div>
          ))}
          <p className="mt-3 text-xs text-slate-500">You can also reply STOP to any text. For adults 21+. Please consume responsibly.</p>
        </section>
      </main>
    </div>
  );
}
