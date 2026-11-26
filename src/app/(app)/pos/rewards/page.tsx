import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { db } from "@/lib/db";
import { reviewCount } from "@/lib/offline-sales";
import { waitingCount } from "@/lib/online-menu";
import { getProgram, listMembers, programStats } from "@/lib/rewards";
import { MAX_SHARE_CEILING, formatPhone, giveBackPercent } from "@/lib/rewards-math";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { rewardsSettingsAction } from "../actions";

export const metadata = { title: "Rewards · Leaf2Sale" };

export default async function RewardsPage({ searchParams }: { searchParams: Promise<{ q?: string; deleted?: string }> }) {
  const session = await requirePagePermission("pos.manage");
  const { q = "", deleted } = await searchParams;
  const [program, members, stats, zone] = await Promise.all([
    getProgram(db, session.orgId),
    listMembers(session.orgId, q),
    programStats(session.orgId),
    facilityZone(session.facilityId),
  ]);
  const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone });

  return (
    <>
      <PageHeader title="Rewards" subtitle="Your rewards program: shoppers earn points on what they pay and spend them as dollars off. Shared by all your stores." />
      <PosTabs current="/pos/rewards" canManage pickups={await waitingCount(session.facilityId)} review={await reviewCount(session.facilityId)} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {deleted ? <p className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">Shopper removed. Their name, phone, birthday and points history are deleted.</p> : null}
          <Card title={`Shoppers (${stats.members})`} action={<span className="text-sm text-slate-600">{stats.points.toLocaleString()} points outstanding</span>}>
            <form className="mb-3 flex gap-2" action="/pos/rewards">
              <input name="q" defaultValue={q} placeholder="Search by first name or phone" aria-label="Search shoppers" className={`${inputClass} flex-1`} />
              <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">
                Search
              </button>
            </form>
            {members.length === 0 ? (
              <p className="text-sm text-slate-600">
                {q ? "No shoppers match." : program.enabled ? "No shoppers yet. Budtenders sign them up at the register, in the cart's Rewards box." : "Turn rewards on to start signing shoppers up at the register."}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm" data-testid="reward-members">
                {members.map((m) => (
                  <li key={m.id}>
                    <Link href={`/pos/rewards/${m.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="font-semibold text-slate-900">{m.firstName}</span>
                        <span className="block text-slate-600">
                          {formatPhone(m.phone)} · last visit {day(m.lastActivityAt)}
                        </span>
                      </span>
                      <span className="font-bold tabular-nums text-slate-900">{m.points.toLocaleString()} pts</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Program settings">
            <ActionForm action={rewardsSettingsAction} submitLabel="Save rewards settings">
              <label className="flex items-start gap-3 text-sm">
                <input autoComplete="off" type="checkbox" name="enabled" defaultChecked={program.enabled} className="mt-0.5 h-5 w-5 accent-brand-700" />
                <span>
                  <span className="font-semibold">Rewards are on</span>
                  <span className="block text-slate-600">Shows the Rewards box in every cart, at all your stores.</span>
                </span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Points per $1" hint="Earned on what the shopper pays after discounts, before tax.">
                  <input autoComplete="off" name="pointsPerDollar" inputMode="numeric" required defaultValue={program.pointsPerDollar} className={inputClass} />
                </Field>
                <Field label="Points for one reward">
                  <input autoComplete="off" name="redeemPoints" inputMode="numeric" required defaultValue={program.redeemPoints} className={inputClass} />
                </Field>
                <Field label="Each reward is worth ($)">
                  <input autoComplete="off" name="redeemDollars" inputMode="decimal" required defaultValue={program.redeemDollars} className={inputClass} />
                </Field>
                <Field label="Most of a cart rewards pay for (%)" hint={`New Mexico doesn't allow free cannabis, so a reward is spread over the cart and can't cover all of it. Up to ${MAX_SHARE_CEILING}%.`}>
                  <input autoComplete="off" name="maxSharePercent" inputMode="numeric" required defaultValue={program.maxSharePercent} className={inputClass} />
                </Field>
                <Field label="Sign-up bonus (points)">
                  <input autoComplete="off" name="signupBonus" inputMode="numeric" required defaultValue={program.signupBonus} className={inputClass} />
                </Field>
                <Field label="Birthday bonus (points)" hint="Once a year, on their first purchase in their birthday month.">
                  <input autoComplete="off" name="birthdayBonus" inputMode="numeric" required defaultValue={program.birthdayBonus} className={inputClass} />
                </Field>
                <Field label="Find shoppers by their ID scan" hint="When on, a returning shopper's rewards account opens when their ID is scanned. Only shoppers who agree are linked, and only a one-way fingerprint of the ID number is kept, never the number or a copy of the ID.">
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input type="checkbox" name="idLookup" defaultChecked={program.idLookup} className="h-5 w-5 accent-brand-700" />
                    Recognize shoppers by their ID scan
                  </label>
                </Field>
                <Field label="Points expire after (months)" hint="With no purchases. 0 means never.">
                  <input autoComplete="off" name="expireMonths" inputMode="numeric" required defaultValue={program.expireMonths} className={inputClass} />
                </Field>
              </div>
              <p className="text-sm text-slate-600">
                Gives back <strong>{giveBackPercent(program)}%</strong> of what members spend. Most dispensaries give back 3 to 5%: the common setup is 1 point per $1 and 100
                points = $5 off.
              </p>
            </ActionForm>
          </Card>
          <Card title="How rewards work at the register">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>In the cart&apos;s Rewards box, type the shopper&apos;s phone. New shoppers sign up there once they agree to join.</li>
              <li>Points are added when the sale is paid, and show on the receipt.</li>
              <li>A voided sale gives back the points spent and takes back the points earned. A return takes back the points those items earned.</li>
              <li>Only a phone number, first name and optional birthday (month and day) are kept. Nothing from their ID.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
