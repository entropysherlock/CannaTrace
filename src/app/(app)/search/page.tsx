import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Search } from "lucide-react";
import Link from "next/link";
import { customers, harvests, items, orders, packages, plants } from "@/db/schema";
import { PageHeader, inputClass } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Search · CannaTrace" };

type Hit = { href: string; title: string; sub: string };

/** Search across the business: packages, plants, harvests, products, orders, and customers. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const org = session.orgId;
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const groups: { label: string; hits: Hit[] }[] = [];
  if (q.length >= 2) {
    const [pk, pl, hv, it, or_, cu] = await Promise.all([
      can(session, "inventory.view")
        ? db
            .select({ id: packages.id, tag: packages.tag, lot: packages.lotNumber, status: packages.status, item: items.name })
            .from(packages)
            .innerJoin(items, eq(items.id, packages.itemId))
            .where(and(eq(packages.orgId, org), or(ilike(packages.tag, like), ilike(packages.lotNumber, like), ilike(items.name, like))))
            .orderBy(desc(packages.createdAt))
            .limit(10)
        : [],
      can(session, "cultivation.view")
        ? db.select({ id: plants.id, tag: plants.tag, phase: plants.phase, batchId: plants.batchId }).from(plants).where(and(eq(plants.orgId, org), ilike(plants.tag, like))).limit(10)
        : [],
      can(session, "cultivation.view")
        ? db.select({ id: harvests.id, name: harvests.name, status: harvests.status }).from(harvests).where(and(eq(harvests.orgId, org), ilike(harvests.name, like))).limit(10)
        : [],
      can(session, "inventory.view")
        ? db.select({ id: items.id, name: items.name, sku: items.sku }).from(items).where(and(eq(items.orgId, org), or(ilike(items.name, like), ilike(items.sku, like)))).limit(10)
        : [],
      can(session, "sales.view")
        ? db
            .select({ id: orders.id, number: orders.number, status: orders.status, customer: customers.name })
            .from(orders)
            .innerJoin(customers, eq(customers.id, orders.customerId))
            .where(and(eq(orders.orgId, org), or(ilike(orders.number, like), ilike(customers.name, like))))
            .orderBy(desc(orders.createdAt))
            .limit(10)
        : [],
      can(session, "sales.view")
        ? db.select({ id: customers.id, name: customers.name, license: customers.licenseNumber }).from(customers).where(and(eq(customers.orgId, org), or(ilike(customers.name, like), ilike(customers.licenseNumber, like)))).limit(10)
        : [],
    ]);
    const word = (s: string) => s.replace(/_/g, " ").toLowerCase();
    groups.push(
      { label: "Packages", hits: pk.map((p) => ({ href: `/inventory/${p.id}`, title: p.tag, sub: `${p.item}${p.lot ? ` · lot ${p.lot}` : ""} · ${word(p.status)}` })) },
      { label: "Plants", hits: pl.map((p) => ({ href: p.batchId ? `/cultivation/batches/${p.batchId}` : "/cultivation/plants", title: p.tag, sub: `${word(p.phase)} · opens its batch` })) },
      { label: "Harvests", hits: hv.map((h) => ({ href: `/cultivation/harvests/${h.id}`, title: h.name, sub: word(h.status) })) },
      { label: "Products", hits: it.map((i) => ({ href: `/catalog/${i.id}`, title: i.name, sub: i.sku })) },
      { label: "Orders", hits: or_.map((o) => ({ href: `/distribution/orders/${o.id}`, title: o.number, sub: `${o.customer} · ${word(o.status)}` })) },
      { label: "Customers and vendors", hits: cu.map((c) => ({ href: `/distribution/customers/${c.id}`, title: c.name, sub: c.license ?? "" })) },
    );
  }
  const found = groups.filter((g) => g.hits.length);
  return (
    <>
      <PageHeader title="Search" subtitle="Packages, plants, harvests, products, orders, and customers across your business." />
      <form action="/search" role="search" className="mb-6 flex max-w-2xl gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search CannaTrace</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input name="q" type="search" defaultValue={q} autoFocus placeholder="A tag, lot, product, order number, or customer" className={`${inputClass} pl-9`} />
        </label>
        <button type="submit" className="min-h-11 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">
          Search
        </button>
      </form>
      {q.length >= 2 ? (
        found.length ? (
          <div className="grid gap-4 lg:grid-cols-2" data-testid="search-results">
            {found.map((g) => (
              <section key={g.label} className="rounded-2xl border border-brand-100 bg-white shadow-sm">
                <h2 className="border-b border-brand-50 px-4 py-3 text-sm font-bold text-brand-900">{g.label}</h2>
                <ul className="divide-y divide-slate-100">
                  {g.hits.map((h) => (
                    <li key={h.href}>
                      <Link href={h.href} className="block px-4 py-2.5 hover:bg-brand-50">
                        <span className="block font-semibold text-slate-900">{h.title}</span>
                        {h.sub ? <span className="block text-xs text-slate-500">{h.sub}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600">Nothing matches &ldquo;{q}&rdquo;.</p>
        )
      ) : q ? (
        <p className="text-sm text-slate-600">Type at least 2 letters.</p>
      ) : null}
    </>
  );
}
