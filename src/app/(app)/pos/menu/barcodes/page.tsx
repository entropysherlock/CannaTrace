import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { items, retailPrices } from "@/db/schema";
import { db } from "@/lib/db";
import { BarcodeError, QUIET_ZONE_MODULES, encode } from "@/lib/labels/barcode";
import { sellableByItem, storePack } from "@/lib/pos";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";

/** One menu item's Code 128 as inline SVG: black bars on white, with the quiet zone scanners need on each side. */
function Bars({ value }: { value: string }) {
  let path: { d: string; width: number } | null = null;
  let problem: string | null = null;
  try {
    const sym = encode("code128", value);
    if (sym.kind === "linear") {
      path = { d: sym.bars.map((b) => `M${b.x + QUIET_ZONE_MODULES} 0h${b.w}v20h${-b.w}z`).join(""), width: sym.modules + QUIET_ZONE_MODULES * 2 };
    }
  } catch (e) {
    problem = e instanceof BarcodeError ? e.message : "This code can't be drawn as a barcode.";
  }
  if (problem || !path) return <p className="text-xs font-semibold text-red-700">{problem}</p>;
  return (
    <svg viewBox={`0 0 ${path.width} 20`} preserveAspectRatio="none" className="h-14 w-full bg-white" role="img" aria-label={`Barcode ${value}`}>
      <path d={path.d} fill="#000" />
    </svg>
  );
}

export default async function MenuBarcodesPage() {
  const session = await requirePagePermission("pos.manage");
  const [menu, sellable] = await Promise.all([
    db
      .select({ id: items.id, name: items.name, sku: items.sku, barcode: items.barcode, unit: items.unit, price: retailPrices.price })
      .from(retailPrices)
      .innerJoin(items, eq(items.id, retailPrices.itemId))
      .where(and(eq(retailPrices.facilityId, session.facilityId), eq(items.active, true)))
      .orderBy(asc(items.name)),
    storePack(db, session.facilityId).then((pack) => sellableByItem(db, session, pack)),
  ]);
  return (
    <div className="mx-auto max-w-[8.5in] p-4 print:max-w-none print:p-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Menu barcode sheet</h1>
          <p className="text-sm text-slate-600">
            One barcode per menu item. Each one is the item&apos;s saved barcode, or its SKU when none is saved; the register accepts both. Print at 100% scale on letter paper.
          </p>
          <Link href="/pos/menu" className="text-sm font-semibold text-brand-700 underline">
            Back to the menu
          </Link>
        </div>
        <PrintButton label="Print this sheet" />
      </div>
      {menu.length === 0 ? (
        <p className="text-slate-600">Nothing is on the menu yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-2 print:gap-y-1" data-testid="barcode-sheet">
          {menu.map((m) => {
            const code = m.barcode ?? m.sku;
            const stock = sellable.get(m.id) ?? new Decimal(0);
            return (
              <li key={m.id} className="break-inside-avoid rounded border border-slate-300 bg-white p-1.5">
                <p className="truncate text-[11px] font-bold leading-tight text-slate-950">{m.name}</p>
                <p className="text-[10px] text-slate-600">
                  ${new Decimal(m.price).toFixed(2)}/{unitLabel(m.unit)}
                  {stock.lte(0) ? " · no stock yet" : ""}
                </p>
                <Bars value={code} />
                <p className="text-center font-mono text-[10px] text-slate-900">{code}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
