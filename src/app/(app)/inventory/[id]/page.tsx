import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import Link from "next/link";
import { LabelLink } from "@/components/labels/label-link";
import { notFound } from "next/navigation";
import { ArrowRightLeft, FlaskConical, MapPin, Merge, Scale, ShieldAlert, Split, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { ScanInput } from "@/components/scan-input";
import { Card, Field, PageHeader, StatusBadge, inputClass } from "@/components/ui";
import {
  auditLogs,
  facilities,
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
import { ADJUST_REASONS, LAB_PROFILE, reasonLabel } from "@/lib/inventory";
import { profileLine } from "@/lib/labels/quantities";
import { can } from "@/lib/rbac";
import { packFor, wasteRule } from "@/lib/rules";
import { requirePagePermission } from "@/lib/session";
import { formatQty, unitLabel } from "@/lib/units";
import { adjustAction, labResultAction, mergeAction, moveAction, splitAction, statusAction } from "../actions";
import { facilityZone } from "@/lib/time";
import { DocumentDrop } from "@/components/document-drop";
import { listDevices } from "@/lib/devices";

function Fold({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white shadow-sm open:ring-2 open:ring-brand-100">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 text-base font-semibold text-slate-900">
        <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
        <span className="flex-1">{title}</span>
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

type LabProfileRow = {
  thcaPercent: string | null;
  d9ThcPercent: string | null;
  cbdaPercent: string | null;
  totalCbdPercent: string | null;
  cbgPercent: string | null;
  cbnPercent: string | null;
  totalCannabinoidsPercent: string | null;
};
const labProfile = (lab: LabProfileRow) =>
  profileLine([
    ["THCa", lab.thcaPercent],
    ["Δ9-THC", lab.d9ThcPercent],
    ["CBDa", lab.cbdaPercent],
    ["Total CBD", lab.totalCbdPercent],
    ["CBG", lab.cbgPercent],
    ["CBN", lab.cbnPercent],
    ["Total cannabinoids", lab.totalCannabinoidsPercent],
  ]);

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("inventory.view");
  const zone = await facilityZone(session.facilityId);
  const { id } = await params;
  const phoneLinked = (await listDevices(session)).some((d) => d.mine);
  const [pkg] = await db
    .select({
      id: packages.id,
      tag: packages.tag,
      quantity: packages.quantity,
      unit: packages.unit,
      status: packages.status,
      heldSince: packages.heldSince,
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

  // Other packages from the same lot: one lab test usually covers the whole lot, so its result can be recorded for all of them at once.
  const sameLot = pkg.lotNumber
    ? await db
        .select({ id: packages.id, tag: packages.tag, quantity: packages.quantity, unit: packages.unit, status: packages.status })
        .from(packages)
        .where(
          and(
            eq(packages.orgId, session.orgId),
            eq(packages.facilityId, session.facilityId),
            eq(packages.lotNumber, pkg.lotNumber),
            ne(packages.id, pkg.id),
            inArray(packages.status, ["ACTIVE", "ON_HOLD", "QUARANTINE", "ALLOCATED"]),
          ),
        )
        .orderBy(packages.tag)
        .limit(100)
    : [];
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
        thcaPercent: labResults.thcaPercent,
        d9ThcPercent: labResults.d9ThcPercent,
        cbdaPercent: labResults.cbdaPercent,
        totalCbdPercent: labResults.totalCbdPercent,
        cbgPercent: labResults.cbgPercent,
        cbnPercent: labResults.cbnPercent,
        totalCannabinoidsPercent: labResults.totalCannabinoidsPercent,
        terpenes: labResults.terpenes,
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
  const [facility] = await db.select({ state: facilities.state, witness: facilities.wasteWitnessRequired }).from(facilities).where(eq(facilities.id, session.facilityId));
  const pack = packFor(facility?.state);
  const wasteRuleHere = wasteRule(pack);
  const waste = pack && wasteRuleHere ? { state: pack.name, holdHours: wasteRuleHere.holdHours, minMixPercent: wasteRuleHere.minMixPercent } : null;
  const heldNote =
    waste && pkg.heldSince && (pkg.status === "ON_HOLD" || pkg.status === "QUARANTINE")
      ? `Held since ${pkg.heldSince.toLocaleString("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" })}.`
      : waste
        ? "It isn't on hold yet."
        : "";
  const canWrite = can(session, "inventory.write");
  const canAdjust = can(session, "inventory.adjust");
  const parents = lineage.filter((l) => l.childId === pkg.id);
  const children = lineage.filter((l) => l.parentId === pkg.id);
  const hidden = <input type="hidden" name="packageId" value={pkg.id} />;
  // A fail stands until a later pass; a newer pending result doesn't change that.
  const decisive = labs.find((l) => l.status !== "PENDING");
  const labState = decisive?.status ?? (labs.length ? "PENDING" : "NONE");
  const retestPending = labs[0]?.status === "PENDING" && decisive;
  const LAB_TILE: Record<string, { label: string; tone: string }> = {
    PASS: { label: "Passed", tone: "border-brand-200 bg-brand-50 text-brand-800" },
    FAIL: { label: "Failed", tone: "border-red-200 bg-red-50 text-red-800" },
    PENDING: { label: "Pending", tone: "border-amber-200 bg-amber-50 text-amber-900" },
    NONE: { label: "Not tested yet", tone: "border-slate-200 bg-white text-slate-700" },
  };
  const hasActions = editable && (canWrite || canAdjust);

  return (
    <>
      <PageHeader
        title={pkg.tag}
        subtitle={`${pkg.itemName} · ${pkg.categoryName}`}
        action={
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-brand-700">
            {can(session, "labels.print") ? (
              <>
                <LabelLink kind="PACKAGE" ids={[pkg.id]}>
                  Print package label
                </LabelLink>
                <LabelLink kind="PRODUCT" ids={[pkg.id]}>
                  Print product label
                </LabelLink>
              </>
            ) : null}
            <Link href="/inventory" className="hover:underline">
              Back to inventory
            </Link>
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="package-summary">
        <div className="rounded-xl border border-brand-100 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">On hand</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-brand-950">{formatQty(pkg.quantity, unit)}</p>
        </div>
        <div className="rounded-xl border border-brand-100 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
          <p className="mt-2">
            <StatusBadge status={pkg.status} />
          </p>
          {pkg.status === "ON_HOLD" || pkg.status === "QUARANTINE" ? <p className="mt-1 text-xs text-slate-600">{heldNote}</p> : null}
        </div>
        <div className="rounded-xl border border-brand-100 bg-white px-4 py-3 shadow-sm">
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Location
          </p>
          <p className="mt-1 truncate text-base font-bold text-slate-900">{locationName.get(pkg.locationId ?? "") ?? "None"}</p>
        </div>
        <div className={`rounded-xl border px-4 py-3 shadow-sm ${LAB_TILE[labState].tone}`}>
          <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide opacity-80">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Lab test
          </p>
          <p className="mt-1 text-base font-bold">{LAB_TILE[labState].label}</p>
          {decisive ? (
            <p className="text-xs opacity-80">
              {decisive.labName}
              {retestPending ? " · retest pending" : ""}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-600">SKU</dt>
              <dd className="text-right text-slate-900">{pkg.sku}</dd>
              <dt className="text-slate-600">Lot</dt>
              <dd className="text-right text-slate-900">{pkg.lotNumber ?? "None"}</dd>
              <dt className="text-slate-600">Cost per {unitLabel(unit)}</dt>
              <dd className="text-right text-slate-900">{pkg.costPerUnit ? `$${new Decimal(pkg.costPerUnit).toFixed(2)}` : "Not set"}</dd>
              <dt className="text-slate-600">Created</dt>
              <dd className="text-right text-slate-900">{pkg.createdAt.toLocaleDateString("en-US", { timeZone: zone })}</dd>
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

          {hasActions ? <h2 className="px-1 pt-2 text-xs font-bold uppercase tracking-wide text-slate-500">What do you want to do?</h2> : null}
          {editable && canWrite ? (
            <Fold title="Move" icon={ArrowRightLeft}>
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
            <Fold title="Adjust quantity" icon={Scale}>
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
              <Fold title="Split into new packages" icon={Split}>
                <ActionForm action={splitAction} submitLabel="Split">
                  {hidden}
                  <p className="text-sm text-slate-600">
                    Fill in one row per new package. Leave unused rows empty, and leave a tag blank to get a new unique ID (PKG-000123). Whatever is not split stays in {pkg.tag}.
                  </p>
                  {[1, 2, 3, 4].map((row) => (
                    <div key={row} className="grid grid-cols-5 gap-2">
                      <input name="tag" aria-label={`New tag ${row}`} placeholder={`New tag ${row} (blank = generate)`} autoCapitalize="characters" className={`${inputClass} col-span-3 font-mono`} />
                      <input name="quantity" aria-label={`Quantity ${row}`} placeholder={unitLabel(unit)} inputMode="decimal" className={`${inputClass} col-span-2`} />
                    </div>
                  ))}
                </ActionForm>
              </Fold>
              <Fold title="Merge with other packages" icon={Merge}>
                <ActionForm action={mergeAction} submitLabel="Merge">
                  {hidden}
                  <Field label="Other package tags" hint="Scan or type each tag, separated by spaces or new lines. Same item and lot only.">
                    <textarea name="otherTags" required rows={3} autoCapitalize="characters" className={`${inputClass} py-2 font-mono`} />
                  </Field>
                  <Field label="Tag for the combined package (blank to generate)">
                    <ScanInput name="newTag" placeholder="Blank = new PKG- ID" />
                  </Field>
                </ActionForm>
              </Fold>
            </>
          ) : null}

          {editable && canAdjust ? (
            <Fold title="Hold, quarantine, or destroy" icon={ShieldAlert}>
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
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>
                    <strong>If destroying:</strong> waste is held at least {waste?.holdHours ?? 72} hours first and must be recorded on video. Keep the footage for at least 120 days.
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input name="videoCamera" aria-label="Camera that recorded it" placeholder="Camera name or number" className={inputClass} />
                    <input name="videoRecordedAt" type="datetime-local" aria-label="Date and time recorded" className={inputClass} />
                  </div>
                  <input name="witnessName" aria-label="Second person who watched" placeholder={facility?.witness ? "Name of the second person who watched (required)" : "Second person who watched (optional)"} className={`${inputClass} mt-2`} />
                </div>
                {waste ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <p>
                      <strong>{waste.state} waste rule:</strong> hold it for {waste.holdHours} hours first, then make it unusable by mixing with at least{" "}
                      {waste.minMixPercent}% non-cannabis material.
                      {heldNote ? ` ${heldNote}` : ""}
                    </p>
                    <label className="mt-2 flex items-start gap-2">
                      <input type="checkbox" name="mixedConfirmed" value="yes" className="mt-0.5 h-5 w-5 accent-brand-700" />
                      <span>If destroying: it was mixed with at least {waste.minMixPercent}% non-cannabis material</span>
                    </label>
                  </div>
                ) : null}
              </ActionForm>
            </Fold>
          ) : null}

          {canWrite ? (
            <Fold title="Add lab result" icon={FlaskConical}>
              <DocumentDrop packageId={id} phoneLinked={phoneLinked}>
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
                  <Field label="Total THC %">
                    <input name="thcPercent" inputMode="decimal" className={inputClass} />
                  </Field>
                  <Field label="CBD %">
                    <input name="cbdPercent" inputMode="decimal" className={inputClass} />
                  </Field>
                </div>
                <details className="rounded-lg border border-slate-200 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-700">Full cannabinoid profile and terpenes (optional)</summary>
                  <p className="mt-2 text-xs text-slate-600">
                    Copy these from the certificate of analysis. Anything filled in here can be printed on labels once the result passes.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {LAB_PROFILE.map(({ key, label }) => (
                      <Field key={key} label={label}>
                        <input name={key} inputMode="decimal" className={inputClass} />
                      </Field>
                    ))}
                  </div>
                  <div className="mt-2">
                    <Field label="Top terpenes" hint='As the lab reports them, for example "Myrcene 0.82%, Limonene 0.41%".'>
                      <input name="terpenes" maxLength={300} className={inputClass} />
                    </Field>
                  </div>
                </details>
                <Field label="Sample date">
                  <input name="sampleDate" type="date" className={inputClass} />
                </Field>
                <Field label="Certificate of analysis" hint="PDF, PNG, or JPEG, up to 4 MB.">
                  <input name="coa" type="file" accept="application/pdf,image/png,image/jpeg" className="block w-full text-sm" />
                </Field>
                <Field label="Notes (optional)">
                  <input name="notes" className={inputClass} />
                </Field>
                {sameLot.length ? (
                  <fieldset className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2" data-testid="same-lot">
                    <legend className="px-1 text-sm font-semibold text-slate-900">
                      Same test, rest of lot {pkg.lotNumber} ({sameLot.length} more)
                    </legend>
                    <p className="mb-2 text-xs text-slate-600">
                      Checked packages get this same result too, each with its own record. A fail quarantines each of them. Uncheck any the test didn&apos;t cover.
                    </p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                      {sameLot.map((p) => (
                        <li key={p.id}>
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="alsoPackageId" value={p.id} defaultChecked className="h-4 w-4 accent-brand-700" />
                            <span className="font-mono">{p.tag}</span>
                            <span className="text-slate-500">
                              {formatQty(p.quantity, p.unit)}
                              {p.status !== "ACTIVE" ? ` · ${p.status.replace("_", " ").toLowerCase()}` : ""}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                ) : null}
              </ActionForm>
              </DocumentDrop>
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
                      <span className="text-slate-500">{lab.sampleDate ?? lab.createdAt.toLocaleDateString("en-US", { timeZone: zone })}</span>
                    </div>
                    <p className="text-slate-700">
                      {lab.thcPercent ? `THC ${num(lab.thcPercent)}%` : "THC not recorded"}
                      {" · "}
                      {lab.cbdPercent ? `CBD ${num(lab.cbdPercent)}%` : "CBD not recorded"}
                      {lab.notes ? ` · ${lab.notes}` : ""}
                    </p>
                    {labProfile(lab) ? (
                      <p className="text-xs text-slate-600" data-testid="lab-profile">
                        {labProfile(lab)}
                      </p>
                    ) : null}
                    {lab.terpenes ? <p className="text-xs text-slate-600">Terpenes: {lab.terpenes}</p> : null}
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
                    <time className="text-slate-500">{t.createdAt.toLocaleString("en-US", { timeZone: zone })}</time>
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

          {can(session, "audit.view") ? (
            <Card title="Audit trail">
              <ul className="divide-y divide-slate-100 text-sm">
                {auditEntries.map((entry) => (
                  <li key={entry.id} className="py-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>
                        <span className="font-semibold text-slate-900">{entry.userName}</span>{" "}
                        <span className="text-slate-600">{entry.action.replaceAll("_", " ").toLowerCase()}</span>
                      </span>
                      <time className="text-slate-500">{entry.createdAt.toLocaleString("en-US", { timeZone: zone })}</time>
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
