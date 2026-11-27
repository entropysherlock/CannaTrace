import { ActionForm } from "@/components/action-form";
import { usd } from "@/components/distribution-ui";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { brandStatement, sponsorships } from "@/lib/marketing";
import { requirePagePermission } from "@/lib/session";
import { facilityToday } from "@/lib/time";
import { sponsorshipAction, sponsorshipRemoveAction } from "../actions";

export const metadata = { title: "Brand promotions · Leaf2Sale" };

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await requirePagePermission("pos.manage");
  const today = await facilityToday(session.facilityId);
  const { from = `${today.slice(0, 8)}01`, to = today } = await searchParams;
  const safe = (v: string, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
  const [promos, statement] = await Promise.all([sponsorships(session.orgId), brandStatement(session.orgId, safe(from, `${today.slice(0, 8)}01`), safe(to, today))]);
  return (
    <>
      <PageHeader title="Brand promotions" subtitle="When a brand pays for part of a discount, record it here. You'll see what each brand owes you from the discounts the register actually gave." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Which brand pays for which promotion">
          {promos.length === 0 ? (
            <p className="text-sm text-slate-600">You have no promotions yet. Create one on the register&apos;s Promotions tab, then come back to link a brand.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm" data-testid="sponsorships">
              {promos.map((p) => (
                <li key={p.id} className="py-3">
                  <p className="font-semibold text-slate-900">
                    {p.name} <span className="font-normal text-slate-600">· {p.kind === "PERCENT" ? `${Number(p.amount)}% off` : `$${Number(p.amount)} off`}{p.active ? "" : " · paused"}</span>
                  </p>
                  <ActionForm action={sponsorshipAction} submitLabel={p.sponsor ? "Update" : "Link a brand"}>
                    <input type="hidden" name="promoId" value={p.id} />
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Brand">
                        <input name="brandName" required maxLength={60} defaultValue={p.sponsor?.brandName ?? ""} className={inputClass} />
                      </Field>
                      <Field label="Brand pays (%)">
                        <input name="fundedPercent" required inputMode="numeric" defaultValue={p.sponsor?.fundedPercent ?? 100} className={inputClass} />
                      </Field>
                      <Field label="Note">
                        <input name="note" maxLength={200} defaultValue={p.sponsor?.note ?? ""} className={inputClass} />
                      </Field>
                    </div>
                  </ActionForm>
                  {p.sponsor ? (
                    <ActionForm action={sponsorshipRemoveAction} submitLabel="Remove brand" quiet>
                      <input type="hidden" name="promoId" value={p.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="What brands owe">
          <form className="mb-3 flex flex-wrap items-end gap-2" action="/marketing/brands">
            <Field label="From">
              <input name="from" type="date" defaultValue={safe(from, "")} className={inputClass} />
            </Field>
            <Field label="Through">
              <input name="to" type="date" defaultValue={safe(to, "")} className={inputClass} />
            </Field>
            <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">
              Show
            </button>
          </form>
          {statement.brands.length === 0 ? (
            <p className="text-sm text-slate-600">No discounts from brand-funded promotions in this period.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1">Brand</th>
                    <th className="text-right">Discounts given</th>
                    <th className="text-right">Brand owes</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.brands.map((b) => (
                    <tr key={b.brand} className="border-t border-slate-100">
                      <td className="py-1.5 font-semibold">{b.brand}</td>
                      <td className="text-right tabular-nums">{usd(b.given)}</td>
                      <td className="text-right font-bold tabular-nums">{usd(b.owes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {statement.lines.map((l) => (
                  <li key={`${l.brand}-${l.promo}`}>
                    {l.brand} · {l.promo}: {l.sales} sale{l.sales === 1 ? "" : "s"}, {usd(l.given)} given, brand pays {l.percent}% = {usd(l.owes)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-600">Counts completed sales only. Voided sales are left out. Partial returns aren&apos;t netted out, so adjust by hand for those.</p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
