import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { asc, eq } from "drizzle-orm";
import { customRoles, facilities as facilitiesTable, organizations, users as usersTable } from "@/db/schema";
import { db } from "@/lib/db";
import { ROLE_LABELS, can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";

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
        <Card title="Facilities">
          <ul className="divide-y divide-slate-100 text-sm">
            {facilities.map((f) => (
              <li key={f.id} className="py-2">
                <p className="font-medium text-slate-900">{f.name}</p>
                <p className="text-slate-600">
                  {f.licenseType.toLowerCase()} · license {f.licenseNumber} · {f.state} · sync: {f.trackTraceSystem.toLowerCase()}
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
