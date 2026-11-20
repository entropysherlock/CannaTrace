import Link from "next/link";
import { CheckedLabelLink } from "@/components/labels/checked-label-link";
import { ActionForm } from "@/components/action-form";
import { PackageBulkFields } from "@/components/package-bulk-fields";
import { packageBulkAction } from "./actions";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { ScanInput } from "@/components/scan-input";
import { buttonLinkClass, inputBase, PageHeader, ScrollBox, StatusBadge } from "@/components/ui";
import { itemCategories, items, locations, packages, type PackageStatus } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { formatQty } from "@/lib/units";

const PAGE_SIZE = 200;
const STATUSES: PackageStatus[] = ["ACTIVE", "ALLOCATED", "ON_HOLD", "QUARANTINE", "FINISHED", "DESTROYED"];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requirePagePermission("inventory.view");
  const { q = "", status = "", page: pageParam = "1" } = await searchParams;
  const query = q.trim();
  // Every word typed must match something about the package (tag, lot, item name, SKU, strain, category or room), in any
  // order, so "blue mesa jar" finds "Blue Mesa 3.5 g Jar". LIKE wildcards are escaped so a scanned tag with % or _ matches literally.
  const words = query.split(/\s+/).filter(Boolean).slice(0, 8);
  const filter = and(
    eq(packages.orgId, session.orgId),
    eq(packages.facilityId, session.facilityId),
    STATUSES.includes(status as PackageStatus) ? eq(packages.status, status as PackageStatus) : undefined,
    ...words.map((word) => {
      const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
      return or(
        ilike(packages.tag, pattern),
        ilike(packages.lotNumber, pattern),
        ilike(items.name, pattern),
        ilike(items.sku, pattern),
        ilike(items.strain, pattern),
        ilike(itemCategories.name, pattern),
        ilike(locations.name, pattern),
      );
    }),
  );
  const [{ total }] = await db
    .select({ total: count() })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .leftJoin(locations, eq(locations.id, packages.locationId))
    .where(filter);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(pageParam, 10) || 1));
  const rows = await db
    .select({
      id: packages.id,
      tag: packages.tag,
      quantity: packages.quantity,
      unit: packages.unit,
      status: packages.status,
      itemName: items.name,
      locationName: locations.name,
    })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .leftJoin(locations, eq(locations.id, packages.locationId))
    .where(filter)
    .orderBy(desc(packages.createdAt), desc(packages.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const canWrite = can(session, "inventory.write");
  const canPrint = can(session, "labels.print");
  const bulk = canWrite || canPrint;
  const rooms = bulk
    ? await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId)))
        .orderBy(asc(locations.name))
    : [];
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = (page - 1) * PAGE_SIZE + rows.length;
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/inventory?${qs}` : "/inventory";
  };

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={
          total <= PAGE_SIZE
            ? `${total.toLocaleString("en-US")} package${total === 1 ? "" : "s"} shown`
            : `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} packages`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {can(session, "labels.print") ? (
              <CheckedLabelLink shownIds={rows.length <= 100 ? rows.map((r) => r.id) : []} />
            ) : null}
            {can(session, "inventory.write") ? (
              <Link href="/inventory/receive" className={buttonLinkClass}>
                Receive package
              </Link>
            ) : null}
          </div>
        }
      />
      <form className="mb-4 flex flex-wrap items-start gap-2">
        <div className="w-full sm:w-auto sm:max-w-md sm:flex-1">
          <ScanInput name="q" defaultValue={query} placeholder="Scan or search tag, item, strain, room, lot" autoFocus submitOnScan />
        </div>
        <select name="status" defaultValue={status} className={`${inputBase} w-auto`}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <button type="submit" className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No packages match. Clear the search, or receive a package to get started.
        </p>
      ) : (
        // The list scrolls inside its own box, so a big inventory doesn't stretch the page.
        <Wrap bulk={bulk} side={<PackageBulkFields locations={rooms} canWrite={canWrite} canPrint={canPrint} />}>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <ScrollBox label="Packages" size="lg">
        <ul className="divide-y divide-slate-100">
          {rows.map((pkg) => (
            <li key={pkg.id} className="flex items-center">
              {bulk ? (
                <input type="checkbox" name="packageId" value={pkg.id} aria-label={`Check ${pkg.tag}`} className="ml-4 h-5 w-5 shrink-0 accent-brand-700" />
              ) : null}
              <Link href={`/inventory/${pkg.id}`} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-brand-50">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-slate-900">{pkg.tag}</p>
                  <p className="truncate text-sm text-slate-600">
                    {pkg.itemName} · {pkg.locationName ?? "no location"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900">{formatQty(pkg.quantity, pkg.unit)}</span>
                  <StatusBadge status={pkg.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        </ScrollBox>
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="font-semibold text-brand-700 hover:underline">
                ← Newer
              </Link>
            ) : (
              <span className="text-slate-400">← Newer</span>
            )}
            <span className="text-slate-600">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="font-semibold text-brand-700 hover:underline">
                Older →
              </Link>
            ) : (
              <span className="text-slate-400">Older →</span>
            )}
          </nav>
        ) : null}
        </div>
        </Wrap>
      )}
    </>
  );
}

/** With permission to act, the list sits in a form beside the "With the checked packages" panel. */
function Wrap({ bulk, side, children }: { bulk: boolean; side: React.ReactNode; children: React.ReactNode }) {
  if (!bulk) return <>{children}</>;
  return (
    <ActionForm action={packageBulkAction} submitLabel="Apply to checked packages" className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">{children}</div>
      <div className="lg:sticky lg:top-4 lg:self-start">{side}</div>
    </ActionForm>
  );
}
