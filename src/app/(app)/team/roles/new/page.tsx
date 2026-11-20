import Link from "next/link";
import { RoleBuilder } from "@/components/role-builder";
import { Card, PageHeader } from "@/components/ui";
import { OWNER_ONLY, ROLES, ROLE_LABELS, permissionsFor } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { isOwner } from "@/lib/team";
import { saveRoleAction } from "../../actions";

export default async function NewRolePage() {
  const session = await requirePagePermission("users.manage");
  return (
    <>
      <PageHeader
        title="Build a role"
        subtitle="Check exactly what people with this role can do. Changes apply to everyone with the role right away."
        action={
          <Link href="/team#roles" className="text-sm font-semibold text-brand-700 hover:underline">
            Back to team
          </Link>
        }
      />
      <Card>
        <RoleBuilder
          action={saveRoleAction}
          templates={ROLES.map((r) => ({ label: ROLE_LABELS[r], permissions: permissionsFor(r) }))}
          ownerOnly={[...OWNER_ONLY]}
          canGrantOwnerOnly={isOwner(session)}
        />
      </Card>
    </>
  );
}
