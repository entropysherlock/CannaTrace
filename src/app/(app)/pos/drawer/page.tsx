import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { usd } from "@/components/distribution-ui";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { drawerSessions } from "@/db/schema";
import { db } from "@/lib/db";
import { drawerSummary } from "@/lib/pos";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { closeDrawerAction } from "../actions";

export default async function DrawerPage() {
  const session = await requirePagePermission("pos.use");
  const sessions = await db
    .select()
    .from(drawerSessions)
    .where(and(eq(drawerSessions.orgId, session.orgId), eq(drawerSessions.facilityId, session.facilityId)))
    .orderBy(desc(drawerSessions.openedAt))
    .limit(30);
  const open = sessions.find((s) => s.status === "OPEN");
  const summary = open ? await drawerSummary(db, open) : null;

  return (
    <>
      <PageHeader title="Cash drawer" subtitle="Count out at the end of the shift to get the end-of-day report." />
      <PosTabs current="/pos/drawer" canManage={can(session, "pos.manage")} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          {open && summary ? (
            <>
              <Card title="This shift so far">
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-slate-600">Opened</dt>
                  <dd className="text-right">
                    {open.openedAt.toLocaleTimeString("en-US")} by {open.openedByName}
                  </dd>
                  <dt className="text-slate-600">Starting cash</dt>
                  <dd className="text-right">{usd(open.openingCash)}</dd>
                  <dt className="text-slate-600">Sales</dt>
                  <dd className="text-right">
                    {summary.saleCount} · {usd(summary.total)}
                  </dd>
                  <dt className="text-slate-600">Cash sales</dt>
                  <dd className="text-right">{usd(summary.cashTotal)}</dd>
                  <dt className="font-semibold text-slate-900">Cash that should be in the drawer</dt>
                  <dd className="text-right text-lg font-bold">{usd(summary.expectedCash)}</dd>
                </dl>
              </Card>
              <Card title="Close the drawer">
                <ActionForm action={closeDrawerAction} submitLabel="Close drawer">
                  <Field label="Cash counted in the drawer, in dollars" hint="Count everything, including the starting cash.">
                    <input name="countedCash" inputMode="decimal" required className={inputClass} />
                  </Field>
                </ActionForm>
              </Card>
            </>
          ) : (
            <Card title="Drawer closed">
              <p className="text-sm text-slate-600">
                Open the drawer from the{" "}
                <Link href="/pos" className="font-semibold text-brand-700 hover:underline">
                  Register
                </Link>{" "}
                to start selling.
              </p>
            </Card>
          )}
        </div>
        <div className="lg:col-span-2">
          <Card title="Past shifts">
            {sessions.filter((s) => s.status === "CLOSED").length === 0 ? (
              <p className="text-sm text-slate-600">No closed shifts yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {sessions
                  .filter((s) => s.status === "CLOSED")
                  .map((s) => {
                    const variance = new Decimal(s.countedCash ?? 0).sub(s.expectedCash ?? 0);
                    return (
                      <li key={s.id}>
                        <Link href={`/pos/drawer/${s.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-2 hover:text-brand-700">
                          <span className="font-semibold">
                            {s.openedAt.toLocaleDateString("en-US")} · {s.openedAt.toLocaleTimeString("en-US")}
                          </span>
                          <span className={variance.isZero() ? "text-slate-600" : "font-semibold text-amber-700"}>
                            {variance.isZero() ? "balanced" : `${variance.gt(0) ? "over" : "short"} by ${usd(variance.abs())}`} ›
                          </span>
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
