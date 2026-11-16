import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pill, usd } from "@/components/distribution-ui";
import { PrintButton } from "@/components/print-button";
import { drawerSessions, facilities, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { drawerSummary } from "@/lib/pos";
import { requirePagePermission } from "@/lib/session";

export default async function DrawerReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("pos.use");
  const { id } = await params;
  const [row] = await db
    .select({ drawer: drawerSessions, facility: facilities })
    .from(drawerSessions)
    .innerJoin(facilities, eq(facilities.id, drawerSessions.facilityId))
    .where(and(eq(drawerSessions.id, id), eq(drawerSessions.orgId, session.orgId), eq(drawerSessions.facilityId, session.facilityId)));
  if (!row) notFound();
  const { drawer, facility } = row;
  const [summary, rows] = await Promise.all([
    drawerSummary(db, drawer),
    db.select().from(sales).where(eq(sales.drawerSessionId, drawer.id)).orderBy(asc(sales.createdAt)),
  ]);
  const counted = drawer.countedCash ? new Decimal(drawer.countedCash) : null;
  const variance = counted ? counted.sub(summary.expectedCash) : null;
  const line = (label: string, value: string, strong = false) => (
    <>
      <dt className={strong ? "font-bold text-slate-900" : "text-slate-600"}>{label}</dt>
      <dd className={`text-right ${strong ? "text-lg font-bold" : ""}`}>{value}</dd>
    </>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href="/pos/drawer" className="text-sm font-semibold text-brand-700 hover:underline">
          Back to cash drawer
        </Link>
        <PrintButton label="Print report" />
      </div>
      <div className="bg-white p-6 text-sm text-slate-900 shadow-sm print:p-0 print:shadow-none">
        <h1 className="text-xl font-bold">End-of-day report</h1>
        <p>
          {facility.name} · license {facility.licenseNumber}
        </p>
        <p className="text-slate-600">
          Opened {drawer.openedAt.toLocaleString("en-US")} by {drawer.openedByName}
          {drawer.closedAt ? ` · closed ${drawer.closedAt.toLocaleString("en-US")} by ${drawer.closedByName}` : " · still open"}
        </p>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 font-semibold">Sales</h2>
            <dl className="grid grid-cols-2 gap-y-1">
              {line("Completed sales", String(summary.saleCount))}
              {line("Voided sales", String(summary.voidCount))}
              {line("Before discounts", usd(summary.subtotal))}
              {line("Discounts given", `-${usd(summary.discounts)}`)}
              {line("Cannabis excise tax", usd(summary.exciseTax))}
              {line("Sales tax", usd(summary.salesTax))}
              {line("Total taken", usd(summary.total), true)}
            </dl>
          </div>
          <div>
            <h2 className="mb-2 font-semibold">Money</h2>
            <dl className="grid grid-cols-2 gap-y-1">
              {line("Debit", usd(summary.debitTotal))}
              {line("Cash", usd(summary.cashTotal))}
              {line("Starting cash", usd(drawer.openingCash))}
              {line("Cash expected in drawer", usd(summary.expectedCash))}
              {line("Cash counted", counted ? usd(counted) : "not counted yet")}
              {line(
                "Difference",
                variance ? (variance.isZero() ? "balanced" : `${variance.gt(0) ? "over" : "short"} by ${usd(variance.abs())}`) : "n/a",
                true,
              )}
            </dl>
          </div>
        </div>

        <h2 className="mb-2 mt-6 font-semibold">Every sale this shift</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-slate-400">
              <th className="py-2 pr-2">Sale</th>
              <th className="py-2 pr-2">Time</th>
              <th className="py-2 pr-2">By</th>
              <th className="py-2 pr-2">Paid</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sale) => (
              <tr key={sale.id} className="border-b border-slate-200">
                <td className="py-2 pr-2">
                  <Link href={`/pos/sales/${sale.id}/receipt`} className="font-semibold text-brand-700 hover:underline print:text-slate-900">
                    {sale.number}
                  </Link>{" "}
                  {sale.status !== "COMPLETED" ? <Pill status={sale.status} /> : null}
                </td>
                <td className="py-2 pr-2">{sale.createdAt.toLocaleTimeString("en-US")}</td>
                <td className="py-2 pr-2">{sale.userName}</td>
                <td className="py-2 pr-2">{sale.paymentMethod?.toLowerCase() ?? ""}</td>
                <td className="py-2 text-right">{sale.total ? usd(sale.total) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
