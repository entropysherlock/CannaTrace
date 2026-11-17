import Link from "next/link";
import { AssistantPanel } from "@/components/assistant-panel";
import { Logo } from "@/components/logo";
import { assistantEnabled } from "@/lib/assistant/engine";
import { BottomNav, SectionTabs, SideNav, type NavGroup, type NavItem, type Tab } from "@/components/side-nav";
import { asc, eq } from "drizzle-orm";
import { facilities as facilitiesTable } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
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

  // Related pages share one sidebar entry and show as tabs at the top of the page.
  const tabs = (list: [string, string, boolean][]) => list.filter(([, , show]) => show).map(([href, label]) => ({ href, label }));
  const entry = (key: string, label: string, list: Tab[]): NavItem | null => (list.length ? { key, label, href: list[0].href, tabs: list } : null);
  const groups: NavGroup[] = [
    { items: [{ key: "dashboard", label: "Dashboard", href: "/dashboard" }] },
    {
      heading: "Operations",
      items: [
        entry("cultivation", "Cultivation", tabs([["/cultivation", "Cultivation", can(session, "cultivation.view")]])),
        entry(
          "inventory",
          "Inventory",
          tabs([
            ["/inventory", "Packages", can(session, "inventory.view")],
            ["/inventory/receive", "Receive", can(session, "inventory.write")],
            ["/counts", "Counts", can(session, "inventory.adjust")],
            ["/catalog", "Items", can(session, "catalog.manage")],
            ["/locations", "Locations", can(session, "catalog.manage")],
          ]),
        ),
        entry("manufacturing", "Manufacturing", tabs([["/manufacturing", "Manufacturing", can(session, "inventory.view")]])),
        entry("distribution", "Distribution", tabs([["/distribution", "Distribution", can(session, "sales.view")]])),
        entry("register", "Register", tabs([["/pos", "Register", can(session, "pos.use")]])),
        entry(
          "labels",
          "SmartLabel AI",
          tabs([
            ["/labels", "Print", can(session, "labels.print")],
            ["/labels/templates", "Templates", can(session, "labels.print")],
            ["/labels/printers", "Printers", can(session, "labels.print")],
            ["/labels/history", "History", can(session, "labels.print")],
          ]),
        ),
      ].filter((x): x is NavItem => Boolean(x)),
    },
    {
      heading: "Insights",
      items: [
        entry(
          "reports",
          "Reports",
          tabs([
            ["/reports", "Reports", can(session, "reports.view")],
            ["/data", "Import and export", can(session, "inventory.view")],
          ]),
        ),
        entry(
          "compliance",
          "Compliance",
          tabs([
            ["/compliance", "State reporting", can(session, "compliance.view")],
            ["/compliance/rules", "State rules", can(session, "compliance.view")],
            ["/audit", "Audit trail", can(session, "audit.view")],
          ]),
        ),
      ].filter((x): x is NavItem => Boolean(x)),
    },
    {
      heading: "Admin",
      items: [
        entry(
          "settings",
          "Settings",
          tabs([
            ["/settings", "Business", can(session, "settings.manage")],
            ["/settings/facilities", "Facilities", can(session, "settings.manage")],
            ["/team", "Team", can(session, "users.manage")],
            ["/integrations", "Integrations", can(session, "integrations.manage")],
          ]),
        ),
      ].filter((x): x is NavItem => Boolean(x)),
    },
  ].filter((g) => g.items.length);

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-brand-950 p-4 text-white md:flex print:!hidden">
        <Link href="/" className="mb-6 px-2" title="CannaTrace home">
          <Logo tone="light" />
        </Link>
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <SideNav groups={groups} />
        </div>
        <div className="mt-4 border-t border-brand-800 px-2 pt-4 text-sm">
          <p className="font-medium">{session.name}</p>
          <p className="text-brand-200">{session.roleName}</p>
          <form action={signOut}>
            <button type="submit" className="mt-2 font-medium text-brand-200 hover:text-white hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex flex-wrap items-center justify-between gap-2 bg-brand-950 px-4 py-3 text-white shadow-md print:hidden">
          <Link href="/" className="md:hidden" title="CannaTrace home">
            <Logo tone="light" />
          </Link>
          <form action={switchFacility} className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto">
            <label htmlFor="facilityId" className="sr-only">
              Facility
            </label>
            <select
              // Keyed by facility so the menu shows the new one after switching from any page.
              key={session.facilityId}
              id="facilityId"
              name="facilityId"
              defaultValue={session.facilityId}
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-brand-700 bg-brand-900 px-3 text-sm font-semibold text-white md:flex-none"
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.licenseNumber}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-10 rounded-lg border border-brand-600 px-3 text-sm font-semibold text-brand-100 hover:bg-brand-800">
              Switch
            </button>
          </form>
          <form action={signOut} className="md:hidden">
            <button type="submit" className="text-sm font-medium text-brand-200">
              Sign out
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          <SectionTabs groups={groups} />
          {children}
        </main>
      </div>

      <BottomNav groups={groups} />
      <AssistantPanel
        enabled={assistantEnabled()}
        firstName={session.name.split(" ")[0]}
        isOwner={session.role === "OWNER" && !session.customRoleId}
        suggestions={[
          "Give me a quick rundown of where things stand",
          can(session, "compliance.view") ? "Are we following our state's rules? What needs fixing?" : null,
          can(session, "inventory.view") ? "What's on hold or in quarantine right now?" : null,
          can(session, "reports.view") ? "What were our top sellers last week?" : null,
          can(session, "sales.view") ? "Which customers owe us money?" : null,
          can(session, "cultivation.view") ? "What's flowering, and how far along is it?" : null,
          can(session, "compliance.view") ? "Did any state reports fail?" : null,
        ]
          .filter((x): x is string => Boolean(x))
          .slice(0, 4)}
      />
    </div>
  );
}
