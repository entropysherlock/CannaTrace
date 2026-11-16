import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { asc, eq } from "drizzle-orm";
import { facilities as facilitiesTable, organizations, users as usersTable } from "@/db/schema";
import { db } from "@/lib/db";
import { ROLES, ROLE_LABELS, can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { addUser } from "./actions";

export default async function SettingsPage() {
  const session = await requirePagePermission("settings.manage");
  const [[org], facilities, users] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, session.orgId)),
    db.select().from(facilitiesTable).where(eq(facilitiesTable.orgId, session.orgId)).orderBy(asc(facilitiesTable.name)),
    db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
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
        <Card title="People">
          <ul className="divide-y divide-slate-100 text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-medium text-slate-900">{u.name}</p>
                  <p className="text-slate-600">{u.email}</p>
                </div>
                <span className="text-slate-700">{ROLE_LABELS[u.role]}</span>
              </li>
            ))}
          </ul>
        </Card>
        {can(session.role, "users.manage") ? (
          <Card title="Add a person">
            <ActionForm action={addUser} submitLabel="Add person">
              <Field label="Name">
                <input name="name" required className={inputClass} />
              </Field>
              <Field label="Email">
                <input name="email" type="email" required className={inputClass} />
              </Field>
              <Field label="Temporary password" hint="At least 8 characters.">
                <input name="password" type="password" minLength={8} required className={inputClass} />
              </Field>
              <Field label="Role">
                <select name="role" defaultValue="READ_ONLY" className={inputClass}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
