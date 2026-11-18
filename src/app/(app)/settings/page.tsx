import Link from "next/link";
import { SWITCH_HREF } from "@/components/switch-systems";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { renameBusinessAction } from "./actions";
import { asc, eq } from "drizzle-orm";
import { customRoles, facilities as facilitiesTable, organizations, users as usersTable } from "@/db/schema";
import { db } from "@/lib/db";
import { ROLE_LABELS, can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { stateName } from "@/lib/states";

export default async function SettingsPage() {
  const session = await requirePagePermission("settings.manage");
  const [[org], facilities, users] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, session.orgId)),
    db.select().from(facilitiesTable).where(eq(facilitiesTable.orgId, session.orgId)).orderBy(asc(facilitiesTable.name)),
    db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, customName: customRoles.name })
      .from(usersTable)
      .leftJoin(customRoles, eq(customRoles.id, usersTable.customRoleId))
      .where(eq(usersTable.orgId, session.orgId))
      .orderBy(asc(usersTable.name)),
  ]);

  return (
    <>
      <PageHeader title="Settings" subtitle={org?.name} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Card title="Business">
            <ActionForm action={renameBusinessAction} submitLabel="Save name" className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <Field label="Business name" hint="Your company's name, shown on reports and to CannaTrace support. Each facility keeps its own name.">
                  <input name="name" required maxLength={100} defaultValue={org?.name} className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </Card>
        </div>
        {can(session, "inventory.write") && can(session, "catalog.manage") ? (
          <div className="lg:col-span-2">
            <Card
              title="Switching from another system?"
              action={
                <Link href={SWITCH_HREF} className="text-sm font-semibold text-brand-700 hover:underline">
                  Switch from Dutchie
                </Link>
              }
            >
              <p className="text-sm text-slate-700">
                Bring your products, rooms, and packages over from Dutchie: export your Current Inventory report in Dutchie Backoffice, upload it, check what will come in,
                then import it in one step. Your state tags and batches come with it. Other systems can use the spreadsheet imports on{" "}
                <Link href="/data" className="font-semibold text-brand-700 hover:underline">
                  Import and export
                </Link>
                .
              </p>
            </Card>
          </div>
        ) : null}
        <Card
          title="Facilities"
          action={
            <Link href="/settings/facilities" className="text-sm font-semibold text-brand-700 hover:underline">
              Manage facilities
            </Link>
          }
        >
          <ul className="divide-y divide-slate-100 text-sm">
            {facilities.map((f) => (
              <li key={f.id} className="py-2">
                <p className="font-medium text-slate-900">{f.name}</p>
                <p className="text-slate-600">
                  {f.licenseType.toLowerCase()} · license {f.licenseNumber} · {stateName(f.state)} · sync: {f.trackTraceSystem.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Team"
          action={
            can(session, "users.manage") ? (
              <Link href="/team" className="text-sm font-semibold text-brand-700 hover:underline">
                Manage team
              </Link>
            ) : null
          }
        >
          <ul className="divide-y divide-slate-100 text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-medium text-slate-900">{u.name}</p>
                  <p className="text-slate-600">{u.email}</p>
                </div>
                <span className="text-slate-700">{u.customName ?? ROLE_LABELS[u.role]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
