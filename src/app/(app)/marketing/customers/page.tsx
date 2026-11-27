import Link from "next/link";
import { Card, PageHeader, inputClass } from "@/components/ui";
import { usd } from "@/components/distribution-ui";
import { listShoppers, segmentCounts } from "@/lib/loyalty";
import { SEGMENTS, segmentLabel } from "@/lib/loyalty-math";
import { formatPhone } from "@/lib/rewards-math";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";

export const metadata = { title: "Customers · Leaf2Sale" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; segment?: string; tag?: string; page?: string }> }) {
  const session = await requirePagePermission("pos.manage");
  const { q = "", segment = "", tag = "", page = "1" } = await searchParams;
  const [list, counts, zone] = await Promise.all([
    listShoppers(session.orgId, { q, segment: segment || undefined, tag: tag || undefined, page: Number(page) || 1 }),
    segmentCounts(session.orgId),
    facilityZone(session.facilityId),
  ]);
  const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }) : "never");
  const link = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(segment ? { segment } : {}), ...(tag ? { tag } : {}), ...extra });
    return `/marketing/customers?${p.toString()}`;
  };
  const pages = Math.max(Math.ceil(list.matching / list.pageSize), 1);
  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone in your rewards program, grouped by how they shop. Click a shopper for their full profile." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/marketing/customers" className={`rounded-full px-3 py-1.5 text-sm font-bold ${!segment ? "bg-brand-600 text-white" : "bg-white text-brand-800 ring-1 ring-brand-100 hover:bg-brand-50"}`}>
          Everyone ({counts.total})
        </Link>
        {SEGMENTS.map((s) => (
          <Link key={s.key} href={`/marketing/customers?segment=${s.key}`} className={`rounded-full px-3 py-1.5 text-sm font-bold ${segment === s.key ? "bg-brand-600 text-white" : "bg-white text-brand-800 ring-1 ring-brand-100 hover:bg-brand-50"}`}>
            {s.label} ({counts[s.key]})
          </Link>
        ))}
      </div>
      <Card title={`${list.matching.toLocaleString()} shopper${list.matching === 1 ? "" : "s"}${tag ? ` tagged ${tag}` : ""}`}>
        <form className="mb-3 flex gap-2" action="/marketing/customers">
          {segment ? <input type="hidden" name="segment" value={segment} /> : null}
          <input name="q" defaultValue={q} placeholder="Search by first name, phone or email" aria-label="Search shoppers" className={`${inputClass} flex-1`} />
          <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">
            Search
          </button>
        </form>
        {list.rows.length === 0 ? (
          <p className="text-sm text-slate-600">{list.total === 0 ? "No shoppers yet. Budtenders sign them up at the register." : "No shoppers match."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="shopper-table">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5">Shopper</th>
                  <th>Group</th>
                  <th>Tier</th>
                  <th className="text-right">Visits</th>
                  <th className="text-right">Spent (12 mo)</th>
                  <th>Last bought</th>
                  <th className="text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-2">
                      <Link href={`/marketing/customers/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                        {r.firstName}
                      </Link>
                      <span className="block text-xs text-slate-600">{formatPhone(r.phone)}</span>
                    </td>
                    <td>{segmentLabel(r.segment)}</td>
                    <td>{r.tier?.name ?? "—"}</td>
                    <td className="text-right tabular-nums">{r.visits}</td>
                    <td className="text-right tabular-nums">{usd(r.spend12m)}</td>
                    <td>{day(r.lastPurchaseAt)}</td>
                    <td className="text-right font-semibold tabular-nums">{r.points.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <p className="mt-3 flex items-center gap-3 text-sm">
            {list.page > 1 ? <Link href={link({ page: String(list.page - 1) })} className="font-semibold text-brand-700 hover:underline">← Previous</Link> : null}
            <span className="text-slate-600">
              Page {list.page} of {pages}
            </span>
            {list.page < pages ? <Link href={link({ page: String(list.page + 1) })} className="font-semibold text-brand-700 hover:underline">Next →</Link> : null}
          </p>
        ) : null}
      </Card>
    </>
  );
}
