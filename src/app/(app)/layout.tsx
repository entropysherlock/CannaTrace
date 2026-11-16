import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { facilities as facilitiesTable } from "@/db/schema";
import { db } from "@/lib/db";
import { ROLE_LABELS, can } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { signOut } from "../login/actions";
import { switchFacility } from "./settings/actions";

// Every screen here needs the signed-in session and live data, so routes are allowed to block.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const facilities = await db
    .select({ id: facilitiesTable.id, name: facilitiesTable.name, licenseNumber: facilitiesTable.licenseNumber })
    .from(facilitiesTable)
    .where(eq(facilitiesTable.orgId, session.orgId))
    .orderBy(asc(facilitiesTable.name));

  const nav = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/inventory", label: "Inventory", show: can(session.role, "inventory.view") },
    { href: "/inventory/receive", label: "Receive", show: can(session.role, "inventory.write") },
    { href: "/counts", label: "Counts", show: can(session.role, "inventory.adjust") },
    { href: "/catalog", label: "Items", show: can(session.role, "catalog.manage") },
    { href: "/locations", label: "Locations", show: can(session.role, "catalog.manage") },
    { href: "/audit", label: "Audit trail", show: can(session.role, "audit.view") },
    { href: "/settings", label: "Settings", show: can(session.role, "settings.manage") },
  ].filter((item) => item.show);

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 print:!hidden shrink-0 flex-col bg-slate-900 p-4 text-slate-100 md:flex">
        <p className="mb-6 text-lg font-bold tracking-tight">
          Canna<span className="text-emerald-400">Trace</span>
        </p>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-slate-800">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-700 pt-4 text-sm">
          <p className="font-medium">{session.name}</p>
          <p className="text-slate-400">{ROLE_LABELS[session.role]}</p>
          <form action={signOut}>
            <button type="submit" className="mt-2 text-emerald-400 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex flex-wrap print:hidden items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <p className="text-base font-bold md:hidden">
            Canna<span className="text-emerald-600">Trace</span>
          </p>
          <form action={switchFacility} className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto">
            <label htmlFor="facilityId" className="sr-only">
              Facility
            </label>
            <select
              id="facilityId"
              name="facilityId"
              defaultValue={session.facilityId}
              className="min-h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm md:flex-none"
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.licenseNumber}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-10 rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">
              Switch
            </button>
          </form>
          <form action={signOut} className="md:hidden">
            <button type="submit" className="text-sm font-medium text-emerald-700">
              Sign out
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>

      <nav className="fixed inset-x-0 print:hidden bottom-0 z-10 flex overflow-x-auto border-t border-slate-200 bg-white md:hidden">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className="flex min-h-14 shrink-0 grow basis-20 items-center justify-center px-1 text-center text-xs font-semibold text-slate-700">
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
