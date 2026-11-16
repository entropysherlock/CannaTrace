import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, StatusBadge, inputClass } from "@/components/ui";
import Decimal from "decimal.js";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  auditLogs,
  inventoryTransactions,
  itemCategories,
  items,
  locations as locationsTable,
  packages,
  users as usersTable,
} from "@/db/schema";
import { db } from "@/lib/db";
import { ADJUST_REASONS, reasonLabel } from "@/lib/inventory";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { formatQty, unitLabel } from "@/lib/units";
import { adjustAction, moveAction } from "../actions";

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("inventory.view");
  const { id } = await params;
  const [pkg] = await db
    .select({
      id: packages.id,
      tag: packages.tag,
      quantity: packages.quantity,
      unit: packages.unit,
      status: packages.status,
      locationId: packages.locationId,
      lotNumber: packages.lotNumber,
      createdAt: packages.createdAt,
      itemName: items.name,
      sku: items.sku,
      categoryName: itemCategories.name,
    })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(and(eq(packages.id, id), eq(packages.orgId, session.orgId), eq(packages.facilityId, session.facilityId)));
  if (!pkg) notFound();

  const [locations, transactions, auditEntries, users] = await Promise.all([
    db
      .select({ id: locationsTable.id, name: locationsTable.name })
      .from(locationsTable)
      .where(and(eq(locationsTable.orgId, session.orgId), eq(locationsTable.facilityId, session.facilityId)))
      .orderBy(asc(locationsTable.name)),
    db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.packageId, pkg.id))
      .orderBy(desc(inventoryTransactions.createdAt)),
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, session.orgId), eq(auditLogs.entityType, "Package"), eq(auditLogs.entityId, pkg.id)))
      .orderBy(desc(auditLogs.createdAt)),
    db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.orgId, session.orgId)),
  ]);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const unit = pkg.unit;
  const num = (value: string) => new Decimal(value).toString();
  const editable = pkg.status !== "DESTROYED" && pkg.status !== "FINISHED";

  return (
    <>
      <PageHeader
        title={pkg.tag}
        subtitle={`${pkg.itemName} · ${pkg.categoryName}`}
        action={
          <Link href="/inventory" className="text-sm font-semibold text-emerald-700 hover:underline">
            Back to inventory
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-1">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-600">Quantity</dt>
              <dd className="text-right text-lg font-bold text-slate-900">{formatQty(pkg.quantity, unit)}</dd>
              <dt className="text-slate-600">Status</dt>
              <dd className="text-right">
                <StatusBadge status={pkg.status} />
              </dd>
              <dt className="text-slate-600">Location</dt>
              <dd className="text-right text-slate-900">{locationName.get(pkg.locationId ?? "") ?? "None"}</dd>
              <dt className="text-slate-600">SKU</dt>
              <dd className="text-right text-slate-900">{pkg.sku}</dd>
              <dt className="text-slate-600">Lot</dt>
              <dd className="text-right text-slate-900">{pkg.lotNumber ?? "None"}</dd>
              <dt className="text-slate-600">Received</dt>
              <dd className="text-right text-slate-900">{pkg.createdAt.toLocaleDateString("en-US")}</dd>
            </dl>
          </Card>

          {editable && can(session.role, "inventory.write") ? (
            <Card title="Move">
              <ActionForm action={moveAction} submitLabel="Move package">
                <input type="hidden" name="packageId" value={pkg.id} />
                <Field label="New location">
                  <select name="toLocationId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a location
                    </option>
                    {locations
                      .filter((l) => l.id !== pkg.locationId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </ActionForm>
            </Card>
          ) : null}

          {editable && can(session.role, "inventory.adjust") ? (
            <Card title="Adjust quantity">
              <ActionForm action={adjustAction} submitLabel="Save adjustment">
                <input type="hidden" name="packageId" value={pkg.id} />
                <Field label={`Counted quantity (${unitLabel(unit)})`} hint="Enter what is really there. The difference is logged for you.">
                  <input name="newQuantity" inputMode="decimal" required className={inputClass} />
                </Field>
                <Field label="Reason">
                  <select name="reasonCode" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {ADJUST_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Note (optional)">
                  <input name="note" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Inventory history">
            <ul className="divide-y divide-slate-100 text-sm">
              {transactions.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold text-slate-900">{t.type.replace("_", " ").toLowerCase()}</span>
                    <time className="text-slate-500">{t.createdAt.toLocaleString("en-US")}</time>
                  </div>
                  <p className="text-slate-700">
                    {t.type === "MOVE"
                      ? `${locationName.get(t.fromLocationId ?? "") ?? "nowhere"} → ${locationName.get(t.toLocationId ?? "") ?? "nowhere"}`
                      : `${num(t.quantityBefore)} → ${num(t.quantityAfter)} ${unitLabel(t.unit)} (${new Decimal(t.quantityDelta).gt(0) ? "+" : ""}${num(t.quantityDelta)})`}
                  </p>
                  <p className="text-slate-500">
                    {userName.get(t.userId) ?? "Unknown user"}
                    {t.reasonCode ? ` · ${reasonLabel(t.reasonCode)}` : ""}
                    {t.note ? ` · ${t.note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          {can(session.role, "audit.view") ? (
            <Card title="Audit trail">
              <ul className="divide-y divide-slate-100 text-sm">
                {auditEntries.map((entry) => (
                  <li key={entry.id} className="py-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>
                        <span className="font-semibold text-slate-900">{entry.userName}</span>{" "}
                        <span className="text-slate-600">{entry.action.toLowerCase()}</span>
                      </span>
                      <time className="text-slate-500">{entry.createdAt.toLocaleString("en-US")}</time>
                    </div>
                    {entry.reason ? <p className="text-slate-600">{entry.reason}</p> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
