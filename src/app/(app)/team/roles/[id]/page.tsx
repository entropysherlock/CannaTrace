import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { RoleBuilder } from "@/components/role-builder";
import { Card, PageHeader } from "@/components/ui";
import { customRoles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { OWNER_ONLY, ROLES, ROLE_LABELS, cleanPermissions, permissionsFor } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { isOwner } from "@/lib/team";
import { deleteRoleAction, saveRoleAction } from "../../actions";

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("users.manage");
  const { id } = await params;
  const [role] = await db.select().from(customRoles).where(and(eq(customRoles.id, id), eq(customRoles.orgId, session.orgId)));
  if (!role) notFound();
  const people = await db.select({ name: users.name }).from(users).where(eq(users.customRoleId, role.id));
  const permissions = cleanPermissions(role.permissions);

  return (
    <>
      <PageHeader
        title={`Edit role: ${role.name}`}
        subtitle={people.length ? `Used by ${people.map((p) => p.name).join(", ")}. Changes apply to them right away.` : "Nobody has this role yet."}
        action={
          <Link href="/team#roles" className="text-sm font-semibold text-brand-700 hover:underline">
            Back to team
          </Link>
        }
      />
      <div className="space-y-5">
        <Card>
          <RoleBuilder
            action={saveRoleAction}
            role={{ id: role.id, name: role.name, description: role.description, permissions }}
            templates={ROLES.map((r) => ({ label: ROLE_LABELS[r], permissions: permissionsFor(r) }))}
            ownerOnly={[...OWNER_ONLY]}
            canGrantOwnerOnly={isOwner(session)}
          />
        </Card>
        <Card title="Delete this role">
          <p className="mb-3 text-sm text-slate-600">
            {people.length ? "Give everyone with this role a different role first." : "Open invites for this role will stop working."}
          </p>
          <ActionForm action={deleteRoleAction} submitLabel="Delete role" quiet>
            <input type="hidden" name="id" value={role.id} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
