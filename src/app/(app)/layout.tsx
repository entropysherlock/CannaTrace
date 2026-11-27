import Link from "next/link";
import { AssistantPanel } from "@/components/assistant-panel";
import { Takeover } from "@/components/takeover";
import { GlobalDrop } from "@/components/global-drop";
import { PhoneHandoff } from "@/components/phone-handoff";
import { WalkthroughProvider } from "@/components/walkthrough";
import { sellsRetail, walkthroughsFor } from "@/lib/walkthroughs";
import { Logo } from "@/components/logo";
import { MainColumn } from "@/components/main-column";
import { FacilitySwitcher, TopBarRight } from "@/components/top-bar";
import { openFindings, sweepIfStaleBriefly } from "@/lib/watch";
import { tallyAvailability } from "@/lib/ai/connection";
import { retentionHours } from "@/lib/assistant/attachments/store";
import { BottomNav, SectionTabs, SideNav, type NavGroup, type NavItem, type Tab } from "@/components/side-nav";
import { and, asc, eq, or } from "drizzle-orm";
import { facilities as facilitiesTable } from "@/db/schema";
import { visibleFacilities } from "@/lib/facility-access";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { isAutomationPaused } from "@/lib/automation";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { requireSession } from "@/lib/session";
import { leaveDemo, signOut } from "../login/actions";
import { switchFacility } from "./settings/actions";

// Every screen here needs the signed-in session and live data, so routes are allowed to block.
export const metadata = { robots: { index: false, follow: false } };

export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supportAdmin = !session.support && (await isPlatformAdmin(session.userId));
  // Leaf2Sale's own staff see "Founder", not "Owner", so it's never mistaken for a shop owner's role.
  const roleName = supportAdmin ? "Founder" : session.roleName;
  const tally = await tallyAvailability(session);
  // The bell in the top bar: what Tally Watch has open at this facility. Re-check first when anything has
  // changed since the last look, so a fixed problem drops off without anyone dismissing it.
  await sweepIfStaleBriefly(session, 1500);
  const alerts = (await openFindings(session)).length;
  const automationPaused = can(session, "settings.manage") ? await isAutomationPaused(session.orgId) : false;
  const facilities = visibleFacilities(
    await db
      .select({ id: facilitiesTable.id, name: facilitiesTable.name, licenseNumber: facilitiesTable.licenseNumber, licenseType: facilitiesTable.licenseType })
      .from(facilitiesTable)
      // Hidden facilities stay off the menu and Dashboard, except the one you're in.
      .where(and(eq(facilitiesTable.orgId, session.orgId), or(eq(facilitiesTable.active, true), eq(facilitiesTable.id, session.facilityId))))
      .orderBy(asc(facilitiesTable.name)),
    session,
  );

  // The register only exists where the facility sells to customers.
  const hereType = facilities.find((f) => f.id === session.facilityId)?.licenseType;
  const hasRegister = sellsRetail(hereType);
  // Related pages share one sidebar entry and show as tabs at the top of the page.
  const tabs = (list: [string, string, boolean][]) => list.filter(([, , show]) => show).map(([href, label]) => ({ href, label }));
  const entry = (key: string, label: string, list: Tab[]): NavItem | null => (list.length ? { key, label, href: list[0].href, tabs: list } : null);
  // Clicking Cultivation opens the Overview; the Grow guide is one of its tabs. The link still lights up on every Cultivation page.
  const cultivationEntry = entry("cultivation", "Cultivation", tabs([["/cultivation", "Cultivation", can(session, "cultivation.view")]]));
  if (cultivationEntry) cultivationEntry.href = "/cultivation/overview";
  const groups: NavGroup[] = [
    { items: [{ key: "dashboard", label: "Dashboard", href: "/dashboard" }] },
    {
      heading: "Operations",
      items: [
        cultivationEntry,
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
        entry("manufacturing", "Manufacturing", tabs([["/manufacturing", "Manufacturing", can(session, "manufacturing.write") || can(session, "audit.view")]])),
        entry("distribution", "Distribution", tabs([["/distribution", "Distribution", can(session, "sales.view")]])),
        entry("register", "Register", tabs([["/pos", "Register", can(session, "pos.use") && hasRegister]])),
      ].filter((x): x is NavItem => Boolean(x)),
    },
    {
      heading: "Tools",
      items: [
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
        // Tally Watch has no menu entry: it's one click away from the bell at the top and the dashboard.
        { key: "walkthroughs", label: "Walkthroughs", href: "/walkthroughs" },
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
            ["/settings/ai", "Tally AI", can(session, "ai.manage")],
            ["/settings/automation", "Automation", can(session, "settings.manage")],
          ]),
        ),
        entry("support", "Support Console", tabs([["/support", "Support Console", supportAdmin]])),
      ].filter((x): x is NavItem => Boolean(x)),
    },
  ].filter((g) => g.items.length);

  return (
    <WalkthroughProvider allowed={walkthroughsFor((p) => can(session, p), hereType)}>
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-brand-950 p-4 text-white short:py-3 md:flex print:!hidden">
        <Link href="/" className="mb-6 flex justify-center short:mb-3" title="Leaf2Sale home">
          <Logo tone="light" />
        </Link>
        <div className="sidebar-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <SideNav groups={groups} />
        </div>
        {/* Password and sign out live in the account menu at the top right, which also shows the name,
            so on short screens this footer gives its room to the menu. */}
        <div className="mt-4 border-t border-brand-800 px-2 pt-4 text-sm short:mt-3 short:pt-3 shorter:hidden">
          <p className="font-medium">{session.name}</p>
          <p className="text-brand-200">{roleName}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-40 md:pb-24">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:gap-3 md:px-6 print:hidden">
          <Link href="/" className="mr-auto md:hidden" title="Leaf2Sale home">
            <Logo />
          </Link>
          <div className="order-last flex w-full min-w-0 md:order-none md:mr-auto md:w-auto">
            <FacilitySwitcher facilities={facilities} current={session.facilityId} action={switchFacility} />
          </div>
          <TopBarRight name={session.name} roleName={roleName} alerts={alerts} signOutAction={signOut} />
        </header>
        {automationPaused && can(session, "settings.manage") ? (
          <div role="note" aria-label="Automation paused" className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900 print:hidden">
            Automation is paused, so nothing runs on its own.{" "}
            <Link href="/settings/automation" className="underline">
              Open automation settings
            </Link>
          </div>
        ) : null}
        {session.supportVisit ? (
          <div role="note" aria-label="Support view" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-violet-700 px-4 py-2 text-center text-sm text-white print:hidden">
            <span>
              <strong>Support view:</strong> you are inside <strong>{session.supportVisit.orgName}</strong> as Leaf2Sale support. Changes are saved under your
              name and the visit is in their audit trail. Ends at{" "}
              {new Date(session.supportVisit.until).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" })}.
            </span>
            <form action="/support/return" method="post">
              <button type="submit" className="rounded-md bg-white px-3 py-1 font-bold text-violet-800 hover:bg-violet-50">
                Exit support view
              </button>
            </form>
          </div>
        ) : null}
        {session.isDemo && !session.supportVisit ? (
          <div role="note" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 print:hidden">
            <span>
              <strong>Live demo.</strong> Everything here is made-up sample data in a sandbox shared with other visitors. It starts fresh every day.
            </span>
            <span className="flex gap-3">
              <Link href="/signup" className="font-bold underline hover:no-underline">
                Create your account
              </Link>
              <form action={leaveDemo}>
                <button type="submit" className="font-bold underline hover:no-underline">
                  Leave the demo
                </button>
              </form>
            </span>
          </div>
        ) : null}
        {/* Centered column; the extra bottom room keeps the last card clear of the floating Tally button. */}
        <MainColumn>
          <SectionTabs groups={groups} />
          {children}
        </MainColumn>
      </div>

      <BottomNav groups={groups} />
      {can(session, "inventory.write") ? (
        <>
          <GlobalDrop />
          <PhoneHandoff />
        </>
      ) : null}
      {tally.ready ? <Takeover /> : null}
      <AssistantPanel
        enabled={tally.ready}
        offReason={tally.reason}
        firstName={session.name.split(" ")[0]}
        isOwner={can(session, "ai.manage")}
        retentionHours={retentionHours()}
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
    </WalkthroughProvider>
  );
}
