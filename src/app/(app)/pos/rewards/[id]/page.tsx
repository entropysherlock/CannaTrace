import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Disclosure } from "@/components/disclosure";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { rewardMembers } from "@/db/schema";
import { db } from "@/lib/db";
import { reviewCount } from "@/lib/offline-sales";
import { waitingCount } from "@/lib/online-menu";
import { memberHistory } from "@/lib/rewards";
import { formatBirthday, formatPhone } from "@/lib/rewards-math";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { rewardsAdjustAction, rewardsDeleteAction, rewardsUpdateAction } from "../../actions";

export const metadata = { title: "Rewards shopper · CannaTrace" };

const KIND: Record<string, string> = {
  SIGNUP: "Welcome bonus",
  EARN: "Earned",
  REDEEM: "Used",
  BIRTHDAY: "Birthday bonus",
  ADJUST: "Correction",
  EXPIRE: "Expired",
  VOID: "Sale voided",
  RETURN: "Return",
};

export default async function RewardsMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("pos.manage");
  const { id } = await params;
  const [member] = await db.select().from(rewardMembers).where(and(eq(rewardMembers.id, id), eq(rewardMembers.orgId, session.orgId)));
  if (!member) notFound();
  const [history, zone] = await Promise.all([memberHistory(session.orgId, member.id), facilityZone(session.facilityId)]);
  const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone });

  return (
    <>
      <PageHeader title={member.firstName} subtitle={`${formatPhone(member.phone)} · ${member.points.toLocaleString()} points · joined ${when(member.joinedAt)}`} />
      <PosTabs current="/pos/rewards" canManage pickups={await waitingCount(session.facilityId)} review={await reviewCount(session.facilityId)} />
      <p className="mb-4 text-sm">
        <Link href="/pos/rewards" className="font-semibold text-brand-700 hover:underline">
          ← All shoppers
        </Link>
      </p>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Points history">
            {history.length === 0 ? (
              <p className="text-sm text-slate-600">No points yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm" data-testid="reward-history">
                {history.map((h) => (
                  <li key={h.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-900">{KIND[h.kind] ?? h.kind}</span>
                      {h.note && h.note !== KIND[h.kind] ? <span className="text-slate-700"> · {h.note}</span> : null}
                      <span className="block text-xs text-slate-500">
                        {when(h.createdAt)} · {h.userName}
                      </span>
                    </span>
                    <span className={`font-bold tabular-nums ${h.points < 0 ? "text-red-700" : "text-brand-800"}`}>
                      {h.points > 0 ? "+" : ""}
                      {h.points.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Correct points">
            <ActionForm action={rewardsAdjustAction} submitLabel="Save correction">
              <input type="hidden" name="memberId" value={member.id} />
              <Field label="Points to add or take away" hint="For example 50, or -50.">
                <input name="points" required inputMode="numeric" placeholder="e.g. 50" className={inputClass} />
              </Field>
              <Field label="Why">
                <input name="reason" required maxLength={200} placeholder="e.g. Points missed on sale S-1042" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
          <Card title="Shopper details">
            <ActionForm action={rewardsUpdateAction} submitLabel="Save details">
              <input type="hidden" name="memberId" value={member.id} />
              <Field label="First name">
                <input name="firstName" required maxLength={40} defaultValue={member.firstName} className={inputClass} />
              </Field>
              <Field label="Phone">
                <input name="phone" required inputMode="tel" defaultValue={formatPhone(member.phone)} className={inputClass} />
              </Field>
              <Field label="Birthday (optional)" hint="Month and day only, for example 3/14.">
                <input name="birthday" defaultValue={member.birthday ? formatBirthday(member.birthday) : ""} placeholder="e.g. 3/14" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
          <Disclosure title="Remove this shopper">
            <ActionForm action={rewardsDeleteAction} submitLabel="Delete shopper" quiet className="space-y-3 px-4 pb-4">
              <input type="hidden" name="memberId" value={member.id} />
              <p className="text-sm text-slate-700">
                For a shopper who asks to leave. Their name, phone, birthday and points ({member.points.toLocaleString()}) are deleted for good. Their past sales stay, as the law
                requires, but no longer point to them.
              </p>
              <Field label="Type DELETE to confirm">
                <input name="confirm" required autoComplete="off" className={inputClass} />
              </Field>
            </ActionForm>
          </Disclosure>
        </div>
      </div>
    </>
  );
}
