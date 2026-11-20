import { ActionForm } from "@/components/action-form";
import { PosTabs } from "@/components/pos-tabs";
import { Card, PageHeader } from "@/components/ui";
import { reviewCount, reviewQueue } from "@/lib/offline-sales";
import { waitingCount } from "@/lib/online-menu";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { reviewSaleAction } from "../actions";

export const metadata = { title: "Sales to review" };

export default async function ReviewPage() {
  const session = await requirePagePermission("pos.manage");
  const [rows, zone, open, pickups] = await Promise.all([reviewQueue(session), facilityZone(session.facilityId), reviewCount(session.facilityId), waitingCount(session.facilityId)]);
  const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: zone }) : "");
  return (
    <>
      <PageHeader
        title="Sales to review"
        subtitle="Sales made while the register was offline that CannaTrace could not fully check afterwards. The sale is already recorded; look at the note, fix anything it points to, then mark it reviewed."
      />
      <PosTabs current="/pos/review" canManage pickups={pickups} review={open} />
      {rows.length === 0 ? (
        <Card>
          <p className="text-slate-600">Nothing to review. Offline sales that pass every check never show up here.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4" data-testid="review-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-bold">
                  {r.number} · ${r.total ?? "0.00"} · sold {when(r.soldAt)} by {r.sellerName}
                </p>
                {r.reviewedAt ? <span className="text-sm text-slate-500">Reviewed {when(r.reviewedAt)} by {r.reviewedBy}</span> : null}
              </div>
              <p className="mt-2 text-sm text-slate-700">{r.reviewNote}</p>
              {r.reviewedAt ? null : (
                <ActionForm action={reviewSaleAction} submitLabel="Mark reviewed" quiet className="mt-3 flex items-start gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input name="note" placeholder="What you did (optional)" className="h-10 w-64 rounded-lg border border-slate-300 px-3 text-sm" />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
