import Link from "next/link";
import { Logo } from "@/components/logo";
import { BottomNav, SideNav } from "@/components/side-nav";
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
    { href: "/cultivation", label: "Cultivation", show: can(session.role, "cultivation.view") },
    { href: "/manufacturing", label: "Manufacturing", show: can(session.role, "inventory.view") },
    { href: "/distribution", label: "Distribution", show: can(session.role, "sales.view") },
    { href: "/pos", label: "Register", show: can(session.role, "pos.use") },
    { href: "/counts", label: "Counts", show: can(session.role, "inventory.adjust") },
    { href: "/catalog", label: "Items", show: can(session.role, "catalog.manage") },
    { href: "/locations", label: "Locations", show: can(session.role, "catalog.manage") },
    { href: "/reports", label: "Reports", show: can(session.role, "reports.view") },
    { href: "/data", label: "Import and export", show: can(session.role, "inventory.view") },
    { href: "/compliance", label: "State reporting", show: can(session.role, "compliance.view") },
    { href: "/audit", label: "Audit trail", show: can(session.role, "audit.view") },
    { href: "/integrations", label: "Integrations", show: can(session.role, "integrations.manage") },
    { href: "/settings", label: "Settings", show: can(session.role, "settings.manage") },
  ].filter((item) => item.show);

  const items = nav.map(({ href, label }) => ({ href, label }));

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-brand-950 p-4 text-white md:flex print:!hidden">
        <Link href="/dashboard" className="mb-6 px-2">
          <Logo tone="light" />
        </Link>
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <SideNav items={items} />
        </div>
        <div className="mt-4 border-t border-brand-800 px-2 pt-4 text-sm">
          <p className="font-medium">{session.name}</p>
          <p className="text-brand-200">{ROLE_LABELS[session.role]}</p>
          <form action={signOut}>
            <button type="submit" className="mt-2 font-medium text-brand-200 hover:text-white hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur print:hidden">
          <Link href="/dashboard" className="md:hidden">
            <Logo />
          </Link>
          <form action={switchFacility} className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto">
            <label htmlFor="facilityId" className="sr-only">
              Facility
            </label>
            <select
              id="facilityId"
              name="facilityId"
              defaultValue={session.facilityId}
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm md:flex-none"
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.licenseNumber}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">
              Switch
            </button>
          </form>
          <form action={signOut} className="md:hidden">
            <button type="submit" className="text-sm font-medium text-brand-700">
              Sign out
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      </div>

      <BottomNav items={items} />
    </div>
  );
}
