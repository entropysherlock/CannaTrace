import bwipjs from "bwip-js/node";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { facilities, items, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { formatQty } from "@/lib/units";

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("inventory.view");
  const { id } = await params;
  const [pkg] = await db
    .select({
      id: packages.id,
      tag: packages.tag,
      quantity: packages.quantity,
      unit: packages.unit,
      lotNumber: packages.lotNumber,
      createdAt: packages.createdAt,
      itemName: items.name,
      strain: items.strain,
      facilityName: facilities.name,
      licenseNumber: facilities.licenseNumber,
    })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .innerJoin(facilities, eq(facilities.id, packages.facilityId))
    .where(and(eq(packages.id, id), eq(packages.orgId, session.orgId), eq(packages.facilityId, session.facilityId)));
  if (!pkg) notFound();

  // Code 128 reads on every common warehouse scanner. The SVG is generated here from the tag only.
  let barcode: string | null = null;
  try {
    barcode = bwipjs.toSVG({ bcid: "code128", text: pkg.tag, height: 14, scale: 2, includetext: false });
  } catch {
    // Older tags may contain characters Code 128 cannot encode; the label still prints with the tag as text.
  }

  return (
    <div className="max-w-md">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={`/inventory/${pkg.id}`} className="text-sm font-semibold text-emerald-700 hover:underline">
          Back to package
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-md border border-slate-400 bg-white p-4 text-slate-900 print:border-0 print:p-0">
        <p className="text-xs font-semibold uppercase tracking-wide">
          {pkg.facilityName} · Lic. {pkg.licenseNumber}
        </p>
        <p className="mt-1 text-lg font-bold leading-tight">{pkg.itemName}</p>
        {pkg.strain ? <p className="text-sm">Strain: {pkg.strain}</p> : null}
        <div className="mt-2 grid grid-cols-2 gap-x-3 text-sm">
          <p>
            <span className="font-semibold">Qty:</span> {formatQty(pkg.quantity, pkg.unit)}
          </p>
          <p>
            <span className="font-semibold">Lot:</span> {pkg.lotNumber ?? "n/a"}
          </p>
          <p>
            <span className="font-semibold">Packaged:</span> {pkg.createdAt.toLocaleDateString("en-US")}
          </p>
        </div>
        {barcode ? (
          <div className="mt-3 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: barcode }} />
        ) : null}
        <p className="mt-1 text-center font-mono text-sm font-semibold tracking-wider">{pkg.tag}</p>
      </div>
      <p className="mt-3 text-xs text-slate-500 print:hidden">
        This is an internal inventory label. State-required consumer warnings and symbols are not included yet.
      </p>
    </div>
  );
}
