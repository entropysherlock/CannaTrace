import Decimal from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { usd } from "@/components/distribution-ui";
import { PosTabs } from "@/components/pos-tabs";
import { reviewCount } from "@/lib/offline-sales";
import { waitingCount } from "@/lib/online-menu";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { drawerSessions } from "@/db/schema";
import { db } from "@/lib/db";
import { drawerSummary, myOpenDrawer, openDrawers } from "@/lib/pos";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { closeDrawerAction } from "../actions";
import { facilityZone } from "@/lib/time";

export default async function DrawerPage() {
  const session = await requirePagePermission("pos.use");
  const zone = await facilityZone(session.facilityId);
  const canManage = can(session, "pos.manage");
  const actor = { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
  const [open, allOpen, sessions] = await Promise.all([
    myOpenDrawer(db, actor),
    canManage ? openDrawers(db, actor) : Promise.resolve([]),
    db
      .select()
      .from(drawerSessions)
      .where(and(eq(drawerSessions.orgId, session.orgId), eq(drawerSessions.facilityId, session.facilityId), eq(drawerSessions.status, "CLOSED")))
      .orderBy(desc(drawerSessions.openedAt))
      .limit(30),
  ]);
  const summary = open ? await drawerSummary(db, open) : null;
  const others = allOpen.filter((d) => d.id !== open?.id);
  const otherSummaries = await Promise.all(others.map((d) => drawerSummary(db, d)));
  // Clerks see only their own past shifts; managers see every drawer at the store.
  const past = canManage ? sessions : sessions.filter((s) => s.userId === session.userId);

  return (
    <>
      <PageHeader title="Cash drawer" subtitle="Each person counts their own drawer at the end of their shift." />
      <PosTabs current="/pos/drawer" canManage={canManage} pickups={await waitingCount(session.facilityId)} review={canManage ? await reviewCount(session.facilityId) : 0} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          {open && summary ? (
            <>
              <Card title="Your drawer">
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-slate-600">Opened</dt>
                  <dd className="text-right">
                    {open.openedAt.toLocaleTimeString("en-US", { timeZone: zone })} by {open.openedByName}
                  </dd>
                  <dt className="text-slate-600">Sales</dt>
                  <dd className="text-right">{summary.saleCount}</dd>
                  {canManage ? (
                    <>
                      <dt className="text-slate-600">Starting cash</dt>
                      <dd className="text-right">{usd(open.openingCash)}</dd>
                      <dt className="text-slate-600">Sales total</dt>
                      <dd className="text-right">{usd(summary.total)}</dd>
                      <dt className="text-slate-600">Cash sales</dt>
                      <dd className="text-right">{usd(summary.cashTotal)}</dd>
                      {summary.refundCount ? (
                        <>
                          <dt className="text-slate-600">Cash refunds for returns</dt>
                          <dd className="text-right">-{usd(summary.cashRefunds)}</dd>
                        </>
                      ) : null}
                      <dt className="font-semibold text-slate-900">Cash that should be in the drawer</dt>
                      <dd className="text-right text-lg font-bold">{usd(summary.expectedCash)}</dd>
                    </>
                  ) : null}
                </dl>
                {canManage ? null : (
                  <p className="mt-3 text-xs text-slate-500">Count the drawer before you see what it should hold. The difference shows on the report after you close.</p>
                )}
              </Card>
              <Card title="Close your drawer">
                <ActionForm action={closeDrawerAction} submitLabel="Close drawer">
                  <Field label="Cash counted in the drawer, in dollars" hint="Count everything, including the starting cash.">
                    <input name="countedCash" inputMode="decimal" required className={inputClass} />
                  </Field>
                </ActionForm>
              </Card>
            </>
          ) : (
            <Card title="Your drawer is closed">
              <p className="text-sm text-slate-600">
                Open your drawer from the{" "}
                <Link href="/pos" className="font-semibold text-brand-700 hover:underline">
                  Register
                </Link>{" "}
                to start selling.
              </p>
            </Card>
          )}
          {others.map((d, i) => (
            <Card key={d.id} title={`${d.openedByName}'s drawer`}>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-slate-600">Opened</dt>
                <dd className="text-right">{d.openedAt.toLocaleTimeString("en-US", { timeZone: zone })}</dd>
                <dt className="text-slate-600">Sales</dt>
                <dd className="text-right">
                  {otherSummaries[i].saleCount} · {usd(otherSummaries[i].total)}
                </dd>
                <dt className="font-semibold text-slate-900">Cash that should be in it</dt>
                <dd className="text-right font-bold">{usd(otherSummaries[i].expectedCash)}</dd>
              </dl>
              <p className="mt-3 text-xs text-slate-500">If they left without counting, count it here to close it for them.</p>
              <ActionForm action={closeDrawerAction} submitLabel={`Close ${d.openedByName}'s drawer`}>
                <input type="hidden" name="drawerId" value={d.id} />
                <Field label="Cash counted, in dollars">
                  <input name="countedCash" inputMode="decimal" required className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ))}
        </div>
        <div className="lg:col-span-2">
          <Card title="Past shifts">
            {past.length === 0 ? (
              <p className="text-sm text-slate-600">No closed shifts yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {past.map((s) => {
                  const variance = new Decimal(s.countedCash ?? 0).sub(s.expectedCash ?? 0);
                  return (
                    <li key={s.id}>
                      <Link href={`/pos/drawer/${s.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-2 hover:text-brand-700">
                        <span className="font-semibold">
                          {s.openedAt.toLocaleDateString("en-US", { timeZone: zone })} · {s.openedAt.toLocaleTimeString("en-US", { timeZone: zone })} · {s.openedByName}
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
