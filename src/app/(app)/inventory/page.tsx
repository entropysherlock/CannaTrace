import Link from "next/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { PageHeader, StatusBadge, buttonLinkClass, inputClass } from "@/components/ui";
import { items, locations, packages, type PackageStatus } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { formatQty } from "@/lib/units";

const STATUSES: PackageStatus[] = ["ACTIVE", "ON_HOLD", "QUARANTINE", "FINISHED", "DESTROYED"];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await requirePagePermission("inventory.view");
  const { q = "", status = "" } = await searchParams;
  const query = q.trim();
  // Escape LIKE wildcards so a scanned tag containing % or _ is matched literally.
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
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
    .leftJoin(locations, eq(locations.id, packages.locationId))
    .where(
      and(
        eq(packages.orgId, session.orgId),
        eq(packages.facilityId, session.facilityId),
        STATUSES.includes(status as PackageStatus) ? eq(packages.status, status as PackageStatus) : undefined,
        query
          ? or(
              ilike(packages.tag, pattern),
              ilike(packages.lotNumber, pattern),
              ilike(items.name, pattern),
              ilike(items.sku, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(desc(packages.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={`${rows.length} package${rows.length === 1 ? "" : "s"} shown`}
        action={
          can(session.role, "inventory.write") ? (
            <Link href="/inventory/receive" className={buttonLinkClass}>
              Receive package
            </Link>
          ) : null
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Scan or search tag, item, SKU, lot"
          autoFocus
          className={`${inputClass} max-w-md flex-1`}
        />
        <select name="status" defaultValue={status} className={`${inputClass} w-auto`}>
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
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {rows.map((pkg) => (
            <li key={pkg.id}>
              <Link href={`/inventory/${pkg.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-emerald-50">
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
      )}
    </>
  );
}
