import { Info } from "lucide-react";
import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Pill, usd } from "@/components/distribution-ui";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { drawerSessions, saleLines, sales } from "@/db/schema";
import { db } from "@/lib/db";
import { getRetailSettings } from "@/lib/pos";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { checkInAction, openDrawerAction } from "./actions";

export default async function RegisterPage() {
  const session = await requirePagePermission("pos.use");
  const [[drawer], settings] = await Promise.all([
    db
      .select()
      .from(drawerSessions)
      .where(and(eq(drawerSessions.orgId, session.orgId), eq(drawerSessions.facilityId, session.facilityId), eq(drawerSessions.status, "OPEN"))),
    getRetailSettings(db, session.facilityId),
  ]);
  const recent = drawer
    ? await db
        .select({
          id: sales.id,
          number: sales.number,
          status: sales.status,
          total: sales.total,
          userName: sales.userName,
          createdAt: sales.createdAt,
          lineCount: sql<number>`(select count(*)::int from ${saleLines} where ${saleLines.saleId} = ${sales.id})`,
        })
        .from(sales)
        .where(eq(sales.drawerSessionId, drawer.id))
        .orderBy(desc(sales.createdAt))
        .limit(40)
    : [];
  const openCarts = recent.filter((s) => s.status === "OPEN");
  const canManage = can(session, "pos.manage");

  return (
    <>
      <PageHeader title="Register" subtitle={drawer ? `Drawer opened by ${drawer.openedByName} at ${drawer.openedAt.toLocaleTimeString("en-US")}` : "The drawer is closed."} />
      <PosTabs current="/pos" canManage={canManage} />
      {!settings.saved ? (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          This store&apos;s purchase limits and tax rates have not been entered, so the register is locked.{" "}
          {canManage ? (
            <Link href="/pos/menu" className="underline">
              Set store rules
            </Link>
          ) : (
            "Ask a manager to set the store rules."
          )}
        </p>
      ) : null}

      {!drawer ? (
        <div className="max-w-md">
          <Card title="Open the drawer">
            <ActionForm action={openDrawerAction} submitLabel="Open drawer">
              <Field label="Cash in the drawer to start, in dollars" hint="Count the float before you begin.">
                <input name="openingCash" inputMode="decimal" required className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Check in a customer">
            <ActionForm action={checkInAction} submitLabel="Start cart">
              <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Enter both dates from the customer&apos;s ID. They are used for the age check only and are not saved.</span></p>
              <Field label="Date of birth on the ID">
                <input name="birthDate" type="date" required className={inputClass} />
              </Field>
              <Field label="ID expiry date">
                <input name="idExpires" type="date" required className={inputClass} />
              </Field>
              <Field label="Customer type">
                <select name="customerType" defaultValue="ADULT_USE" className={inputClass}>
                  <option value="ADULT_USE">Adult use ({settings.adultMinAge}+)</option>
                  <option value="MEDICAL">Medical patient (card checked)</option>
                </select>
              </Field>
            </ActionForm>
          </Card>

          <div className="space-y-5 lg:col-span-2">
            <Card title={`Open carts (${openCarts.length})`}>
              {openCarts.length === 0 ? (
                <p className="text-sm text-slate-600">No carts in progress.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {openCarts.map((cart) => (
                    <li key={cart.id}>
                      <Link href={`/pos/sales/${cart.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:text-brand-700">
                        <span className="font-semibold">{cart.number}</span>
                        <span className="text-slate-600">
                          {cart.lineCount} item{cart.lineCount === 1 ? "" : "s"} · {cart.userName} ›
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="This shift">
              {recent.filter((s) => s.status !== "OPEN").length === 0 ? (
                <p className="text-sm text-slate-600">No sales yet this shift.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {recent
                    .filter((s) => s.status !== "OPEN")
                    .map((sale) => (
                      <li key={sale.id}>
                        <Link href={`/pos/sales/${sale.id}/receipt`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:text-brand-700">
                          <span>
                            <span className="font-semibold">{sale.number}</span> <Pill status={sale.status} />
                          </span>
                          <span className="text-slate-600">
                            {sale.total ? usd(sale.total) : ""} · {sale.createdAt.toLocaleTimeString("en-US")}
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
