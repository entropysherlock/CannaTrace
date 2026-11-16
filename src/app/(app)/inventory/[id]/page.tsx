import Decimal from "decimal.js";
import { and, asc, desc, eq, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { ScanInput } from "@/components/scan-input";
import { Card, Field, PageHeader, StatusBadge, inputClass } from "@/components/ui";
import {
  auditLogs,
  inventoryTransactions,
  itemCategories,
  items,
  labResults,
  locations as locationsTable,
  packageLineage,
  packages,
  users as usersTable,
} from "@/db/schema";
import { db } from "@/lib/db";
import { ADJUST_REASONS, reasonLabel } from "@/lib/inventory";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { formatQty, unitLabel } from "@/lib/units";
import { adjustAction, labResultAction, mergeAction, moveAction, splitAction, statusAction } from "../actions";

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-base font-semibold text-slate-900">
        {title}
        <span className="text-slate-400 group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}

const LAB_STYLES: Record<string, string> = {
  PASS: "text-brand-700",
  FAIL: "text-red-700",
  PENDING: "text-amber-700",
};

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
      costPerUnit: packages.costPerUnit,
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

  const [locations, transactions, auditEntries, users, lineage, labs] = await Promise.all([
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
    db
      .select({ parentId: packageLineage.parentId, childId: packageLineage.childId, id: packages.id, tag: packages.tag })
      .from(packageLineage)
      .innerJoin(
        packages,
        or(
          and(eq(packageLineage.childId, pkg.id), eq(packages.id, packageLineage.parentId)),
          and(eq(packageLineage.parentId, pkg.id), eq(packages.id, packageLineage.childId)),
        ),
      )
      .where(or(eq(packageLineage.childId, pkg.id), eq(packageLineage.parentId, pkg.id))),
    db
      .select({
        id: labResults.id,
        labName: labResults.labName,
        status: labResults.status,
        sampleDate: labResults.sampleDate,
        thcPercent: labResults.thcPercent,
        cbdPercent: labResults.cbdPercent,
        notes: labResults.notes,
        coaFileName: labResults.coaFileName,
        createdAt: labResults.createdAt,
      })
      .from(labResults)
      .where(eq(labResults.packageId, pkg.id))
      .orderBy(desc(labResults.createdAt)),
  ]);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const unit = pkg.unit;
  const num = (value: string) => new Decimal(value).toString();
  const editable = pkg.status !== "DESTROYED" && pkg.status !== "FINISHED";
  const canWrite = can(session.role, "inventory.write");
  const canAdjust = can(session.role, "inventory.adjust");
  const parents = lineage.filter((l) => l.childId === pkg.id);
  const children = lineage.filter((l) => l.parentId === pkg.id);
  const hidden = <input type="hidden" name="packageId" value={pkg.id} />;

  return (
    <>
      <PageHeader
        title={pkg.tag}
        subtitle={`${pkg.itemName} · ${pkg.categoryName}`}
        action={
          <div className="flex items-center gap-4 text-sm font-semibold text-brand-700">
            <Link href={`/inventory/${pkg.id}/label`} className="hover:underline">
              Print label
            </Link>
            <Link href="/inventory" className="hover:underline">
              Back to inventory
            </Link>
          </div>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
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
              <dt className="text-slate-600">Cost per {unitLabel(unit)}</dt>
              <dd className="text-right text-slate-900">{pkg.costPerUnit ? `$${new Decimal(pkg.costPerUnit).toFixed(2)}` : "Not set"}</dd>
              <dt className="text-slate-600">Created</dt>
              <dd className="text-right text-slate-900">{pkg.createdAt.toLocaleDateString("en-US")}</dd>
            </dl>
            {parents.length || children.length ? (
              <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                {parents.length ? (
                  <p className="text-slate-600">
                    Made from:{" "}
                    {parents.map((p) => (
                      <Link key={p.id} href={`/inventory/${p.id}`} className="mr-2 font-mono font-semibold text-brand-700 hover:underline">
                        {p.tag}
                      </Link>
                    ))}
                  </p>
                ) : null}
                {children.length ? (
                  <p className="mt-1 text-slate-600">
                    Went into:{" "}
                    {children.map((c) => (
                      <Link key={c.id} href={`/inventory/${c.id}`} className="mr-2 font-mono font-semibold text-brand-700 hover:underline">
                        {c.tag}
                      </Link>
                    ))}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>

          {editable && canWrite ? (
            <Fold title="Move">
              <ActionForm action={moveAction} submitLabel="Move package">
                {hidden}
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
            </Fold>
          ) : null}

          {editable && canAdjust ? (
            <Fold title="Adjust quantity">
              <ActionForm action={adjustAction} submitLabel="Save adjustment">
                {hidden}
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
            </Fold>
          ) : null}

          {pkg.status === "ACTIVE" && canWrite ? (
            <>
              <Fold title="Split into new packages">
                <ActionForm action={splitAction} submitLabel="Split">
                  {hidden}
                  <p className="text-sm text-slate-600">
                    Fill in one row per new package. Leave unused rows empty. Whatever is not split stays in {pkg.tag}.
                  </p>
                  {[1, 2, 3, 4].map((row) => (
                    <div key={row} className="grid grid-cols-5 gap-2">
                      <input name="tag" aria-label={`New tag ${row}`} placeholder={`New tag ${row}`} autoCapitalize="characters" className={`${inputClass} col-span-3 font-mono`} />
                      <input name="quantity" aria-label={`Quantity ${row}`} placeholder={unitLabel(unit)} inputMode="decimal" className={`${inputClass} col-span-2`} />
                    </div>
                  ))}
                </ActionForm>
              </Fold>
              <Fold title="Merge with other packages">
                <ActionForm action={mergeAction} submitLabel="Merge">
                  {hidden}
                  <Field label="Other package tags" hint="Scan or type each tag, separated by spaces or new lines. Same item and lot only.">
                    <textarea name="otherTags" required rows={3} autoCapitalize="characters" className={`${inputClass} py-2 font-mono`} />
                  </Field>
                  <Field label="Tag for the combined package">
                    <ScanInput name="newTag" required />
                  </Field>
                </ActionForm>
              </Fold>
            </>
          ) : null}

          {editable && canAdjust ? (
            <Fold title="Hold, quarantine, or destroy">
              <ActionForm action={statusAction} submitLabel="Update status">
                {hidden}
                <Field label="New status">
                  <select name="status" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a status
                    </option>
                    {pkg.status !== "ACTIVE" ? <option value="ACTIVE">Release (back to active)</option> : null}
                    {pkg.status !== "ON_HOLD" ? <option value="ON_HOLD">On hold</option> : null}
                    {pkg.status !== "QUARANTINE" ? <option value="QUARANTINE">Quarantine</option> : null}
                    <option value="DESTROYED">Destroyed (cannot be undone)</option>
                  </select>
                </Field>
                <Field label="Reason" hint="Required. Shown in the audit trail.">
                  <input name="reason" required className={inputClass} />
                </Field>
              </ActionForm>
            </Fold>
          ) : null}

          {canWrite ? (
            <Fold title="Add lab result">
              <ActionForm action={labResultAction} submitLabel="Save result">
                {hidden}
                <Field label="Testing lab">
                  <input name="labName" required className={inputClass} />
                </Field>
                <Field label="Result" hint="A failing result quarantines the package automatically.">
                  <select name="status" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose a result
                    </option>
                    <option value="PASS">Pass</option>
                    <option value="FAIL">Fail</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="THC %">
                    <input name="thcPercent" inputMode="decimal" className={inputClass} />
                  </Field>
                  <Field label="CBD %">
                    <input name="cbdPercent" inputMode="decimal" className={inputClass} />
                  </Field>
                </div>
                <Field label="Sample date">
                  <input name="sampleDate" type="date" className={inputClass} />
                </Field>
                <Field label="Certificate of analysis" hint="PDF, PNG, or JPEG, up to 4 MB.">
                  <input name="coa" type="file" accept="application/pdf,image/png,image/jpeg" className="block w-full text-sm" />
                </Field>
                <Field label="Notes (optional)">
                  <input name="notes" className={inputClass} />
                </Field>
              </ActionForm>
            </Fold>
          ) : null}
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Lab results">
            {labs.length === 0 ? (
              <p className="text-sm text-slate-600">No lab results recorded for this package.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {labs.map((lab) => (
                  <li key={lab.id} className="py-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>
                        <span className={`font-bold ${LAB_STYLES[lab.status]}`}>{lab.status.toLowerCase()}</span>{" "}
                        <span className="text-slate-900">· {lab.labName}</span>
                      </span>
                      <span className="text-slate-500">{lab.sampleDate ?? lab.createdAt.toLocaleDateString("en-US")}</span>
                    </div>
                    <p className="text-slate-700">
                      {lab.thcPercent ? `THC ${num(lab.thcPercent)}%` : "THC not recorded"}
                      {" · "}
                      {lab.cbdPercent ? `CBD ${num(lab.cbdPercent)}%` : "CBD not recorded"}
                      {lab.notes ? ` · ${lab.notes}` : ""}
                    </p>
                    {lab.coaFileName ? (
                      <a href={`/api/coa/${lab.id}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">
                        View COA ({lab.coaFileName})
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Inventory history">
            <ul className="divide-y divide-slate-100 text-sm">
              {transactions.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold text-slate-900">{t.type.replace("_", " ").toLowerCase()}</span>
                    <time className="text-slate-500">{t.createdAt.toLocaleString("en-US")}</time>
                  </div>
                  {t.type === "MOVE" ? (
                    <p className="text-slate-700">
                      {locationName.get(t.fromLocationId ?? "") ?? "nowhere"} → {locationName.get(t.toLocationId ?? "") ?? "nowhere"}
                    </p>
                  ) : t.type === "STATUS_CHANGE" ? null : (
                    <p className="text-slate-700">
                      {num(t.quantityBefore)} → {num(t.quantityAfter)} {unitLabel(t.unit)} ({new Decimal(t.quantityDelta).gt(0) ? "+" : ""}
                      {num(t.quantityDelta)})
                    </p>
                  )}
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
                        <span className="text-slate-600">{entry.action.replaceAll("_", " ").toLowerCase()}</span>
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
