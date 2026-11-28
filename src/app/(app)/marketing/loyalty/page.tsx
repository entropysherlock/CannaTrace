import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { usd } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { db } from "@/lib/db";
import { getBoosts, getMarketingSettings } from "@/lib/loyalty-earn";
import { listExclusions, tierSummary } from "@/lib/loyalty";
import { requirePagePermission } from "@/lib/session";
import { facilityToday } from "@/lib/time";
import { boostAction, boostDeleteAction, exclusionAction, exclusionRemoveAction, marketingSettingsAction, tierAction, tierDeleteAction } from "../actions";

export const metadata = { title: "Loyalty · Leaf2Sale" };

export default async function LoyaltyPage() {
  const session = await requirePagePermission("pos.manage");
  const [tiers, boosts, settings, today, exclusions] = await Promise.all([tierSummary(session.orgId), getBoosts(db, session.orgId), getMarketingSettings(db, session.orgId), facilityToday(session.facilityId), listExclusions(session.orgId)]);
  return (
    <>
      <PageHeader title="Loyalty" subtitle="Tiers, bonus-points days, referrals and your marketing rules. The basics (points per dollar, reward size, expiry) are on the Rewards page." />
      <p className="mb-5 text-sm">
        <Link href="/pos/rewards" className="font-semibold text-brand-700 hover:underline">
          Open Rewards: points per dollar, reward size, expiry
        </Link>
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Tiers">
          <p className="mb-3 text-sm text-slate-600">A shopper&apos;s tier is the highest one their spending over the last 12 months reaches. Higher tiers earn points faster. The top tier also sets the VIP line.</p>
          {tiers.length > 0 ? (
            <ul className="mb-4 divide-y divide-slate-100 text-sm" data-testid="tiers">
              {tiers.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-semibold">{t.name}</span> · {usd(t.minSpend as string)}+ a year · {t.earnPercent}% points speed
                    <span className="block text-xs text-slate-600">
                      {t.members} shopper{t.members === 1 ? "" : "s"}
                      {t.perk ? ` · ${t.perk}` : ""}
                    </span>
                  </span>
                  <ActionForm action={tierDeleteAction} submitLabel="Remove" quiet submitAriaLabel={`Remove ${t.name}`} className="shrink-0">
                    <input type="hidden" name="tierId" value={t.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={tierAction} submitLabel="Save tier">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tier name">
                <input name="name" required maxLength={30} placeholder="Gold" className={inputClass} />
              </Field>
              <Field label="Spend to reach it ($/year)">
                <input name="minSpend" required inputMode="decimal" placeholder="1000" className={inputClass} />
              </Field>
              <Field label="Points speed (%)" hint="100 is normal. 125 earns 25% more points.">
                <input name="earnPercent" required inputMode="numeric" defaultValue="100" className={inputClass} />
              </Field>
              <Field label="Perk note (optional)">
                <input name="perk" maxLength={120} placeholder="Early access to drops" className={inputClass} />
              </Field>
            </div>
            <p className="text-xs text-slate-600">Typing a name that exists updates that tier. Tier perks should be discounts or points, never free cannabis (New Mexico doesn&apos;t allow it).</p>
          </ActionForm>
        </Card>
        <Card title="Bonus-points days">
          <p className="mb-3 text-sm text-slate-600">Between two dates, everyone earns points faster. Whether it stacks with tier speed is your choice under Margin protection below.</p>
          {boosts.length > 0 ? (
            <ul className="mb-4 divide-y divide-slate-100 text-sm" data-testid="boosts">
              {boosts.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-semibold">{b.name}</span> · {b.earnPercent}% speed
                    <span className="block text-xs text-slate-600">
                      {b.startDate} to {b.endDate}
                      {b.startDate <= today && today <= b.endDate ? " · running now" : b.endDate < today ? " · ended" : " · coming up"}
                    </span>
                  </span>
                  <ActionForm action={boostDeleteAction} submitLabel="Remove" quiet submitAriaLabel={`Remove ${b.name}`} className="shrink-0">
                    <input type="hidden" name="boostId" value={b.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={boostAction} submitLabel="Add bonus days">
            <Field label="Name">
              <input name="name" required maxLength={40} placeholder="Double points weekend" className={inputClass} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="From">
                <input name="startDate" type="date" required className={inputClass} />
              </Field>
              <Field label="Through">
                <input name="endDate" type="date" required className={inputClass} />
              </Field>
              <Field label="Speed (%)" hint="200 is double points.">
                <input name="earnPercent" required inputMode="numeric" defaultValue="200" className={inputClass} />
              </Field>
            </div>
          </ActionForm>
        </Card>
        <Card title="Margin protection" className="lg:col-span-2">
          <p className="mb-3 text-sm text-slate-600">
            Items and categories listed here don&apos;t earn points, and rewards can&apos;t pay for them. Use it for thin-margin products. Rewards still can&apos;t pay for more than your Rewards page share of what&apos;s left.
          </p>
          {exclusions.rows.length > 0 ? (
            <ul className="mb-4 divide-y divide-slate-100 text-sm" data-testid="exclusions">
              {exclusions.rows.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-semibold">{e.name}</span> <span className="text-xs text-slate-600">· {e.kind === "CATEGORY" ? "whole category" : "single item"}</span>
                  </span>
                  <ActionForm action={exclusionRemoveAction} submitLabel="Remove" quiet submitAriaLabel={`Include ${e.name} again`} className="shrink-0">
                    <input type="hidden" name="exclusionId" value={e.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-slate-600">Nothing is left out right now.</p>
          )}
          <ActionForm action={exclusionAction} submitLabel="Leave out">
            <Field label="Leave out of points and rewards">
              <select name="pick" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Pick a category or an item
                </option>
                <optgroup label="Categories">
                  {exclusions.categories.map((c) => (
                    <option key={c.id} value={`CATEGORY:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Items">
                  {exclusions.items.map((i) => (
                    <option key={i.id} value={`ITEM:${i.id}`}>
                      {i.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
          </ActionForm>
        </Card>
        <Card title="Marketing rules" className="lg:col-span-2">
          <ActionForm action={marketingSettingsAction} submitLabel="Save rules">
            <Field label="Required statement" hint="New Mexico requires cannabis marketing to carry a statement such as Please Consume Responsibly (16.8.3.8 NMAC). It is added to every message that lacks it. Check the full required wording with the Cannabis Control Division or your lawyer.">
              <input name="disclaimer" required maxLength={300} defaultValue={settings.disclaimer} className={inputClass} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Quiet hours start" hint="No texts from this time, in your store's time zone.">
                <input name="quietStart" required defaultValue={settings.quietStart} placeholder="21:00" className={inputClass} />
              </Field>
              <Field label="Quiet hours end">
                <input name="quietEnd" required defaultValue={settings.quietEnd} placeholder="08:00" className={inputClass} />
              </Field>
              <Field label="Most messages per shopper per week">
                <input name="maxPerWeek" required inputMode="numeric" defaultValue={settings.maxPerWeek} className={inputClass} />
              </Field>
              <Field label="Referral bonus (points)" hint="The referrer gets this when the person they referred makes a first purchase. 0 turns referrals off.">
                <input name="referralBonus" required inputMode="numeric" defaultValue={settings.referralBonus} className={inputClass} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tier speed and bonus days" hint="Multiply: a Gold shopper on a double-points day earns both. Best of the two: they earn whichever is higher, never both, which protects margin.">
                <select name="stackMode" defaultValue={settings.stackMode} className={inputClass}>
                  <option value="MULTIPLY">Multiply together</option>
                  <option value="BEST">Only the better one</option>
                </select>
              </Field>
              <label className="flex items-start gap-2 text-sm text-slate-800 sm:mt-6">
                <input type="checkbox" name="doubleOptIn" defaultChecked={settings.doubleOptIn} className="mt-1" />
                <span>
                  <strong>Double opt-in.</strong> A &quot;yes&quot; at the register only counts after the shopper confirms: an email link, or replying YES to a text. Nothing marketing is sent until then.
                </span>
              </label>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
