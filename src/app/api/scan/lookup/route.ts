import { and, eq, ilike, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { items, packages } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

/** What a scanned code is: a package tag or lot at this store, or an item's SKU. */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!can(session, "inventory.view")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const code = (new URL(request.url).searchParams.get("code") ?? "").trim().slice(0, 80);
  if (!code) return NextResponse.json({ found: null });
  const exact = (col: Parameters<typeof ilike>[0]) => ilike(col, code.replace(/[%_\\]/g, "\\$&"));
  const [pkg] = await db
    .select({ id: packages.id, tag: packages.tag, lot: packages.lotNumber, quantity: packages.quantity, unit: packages.unit, status: packages.status, item: items.name })
    .from(packages)
    .innerJoin(items, eq(items.id, packages.itemId))
    .where(and(eq(packages.orgId, session.orgId), eq(packages.facilityId, session.facilityId), or(exact(packages.tag), exact(packages.lotNumber))))
    .limit(1);
  if (pkg) return NextResponse.json({ found: { kind: "package", id: pkg.id, title: pkg.item, detail: `${pkg.tag} · ${Number(pkg.quantity)} ${pkg.unit} · ${pkg.status.toLowerCase().replace("_", " ")}`, href: `/inventory/${pkg.id}` } });
  const [item] = await db.select({ id: items.id, name: items.name, sku: items.sku }).from(items).where(and(eq(items.orgId, session.orgId), exact(items.sku))).limit(1);
  if (item) return NextResponse.json({ found: { kind: "item", id: item.id, title: item.name, detail: `SKU ${item.sku}`, href: `/inventory?q=${encodeURIComponent(item.sku)}` } });
  return NextResponse.json({ found: null });
}
