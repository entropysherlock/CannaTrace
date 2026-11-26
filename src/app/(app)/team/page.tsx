import { Info } from "lucide-react";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { InviteForm, type RoleOption } from "@/components/invite-form";
import { Card, PageHeader, buttonLinkClass, inputBase } from "@/components/ui";
import { customRoles, facilities, invites, users } from "@/db/schema";
import { db } from "@/lib/db";
import { OWNER_ONLY, ROLES, ROLE_LABELS, cleanPermissions, permissionsFor } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { isOwner } from "@/lib/team";
import { ResetLinkButton } from "@/components/reset-link-button";
import { changeRoleAction, inviteAction, resetLinkAction, resetTwoFactorAction, revokeInviteAction, setActiveAction, setFacilitiesAction } from "./actions";
import { facilityZone } from "@/lib/time";

const BUILT_IN_HINTS: Record<string, string> = {
  OWNER: "Everything, including the team and API keys.",
  MANAGER: "Everything except the team and API keys.",
  INVENTORY: "Inventory, items, production, and reports.",
  CULTIVATION: "Plants and harvests.",
  SALES: "Wholesale customers and orders.",
  BUDTENDER: "The register only.",
  READ_ONLY: "Can look, cannot change anything.",
};

const date = (d: Date, zone: string) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });

export default async function TeamPage() {
  const session = await requirePagePermission("users.manage");
  const zone = await facilityZone(session.facilityId);
  const owner = isOwner(session);
  const [people, roles, pending, counts] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        customRoleId: users.customRoleId,
        active: users.active,
        customName: customRoles.name,
        facilityIds: users.facilityIds,
        twoStep: users.totpEnabledAt,
      })
      .from(users)
      .leftJoin(customRoles, eq(customRoles.id, users.customRoleId))
      .where(eq(users.orgId, session.orgId))
      .orderBy(desc(users.active), asc(users.name)),
    db.select().from(customRoles).where(eq(customRoles.orgId, session.orgId)).orderBy(asc(customRoles.name)),
    db
      .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt, customName: customRoles.name })
      .from(invites)
      .leftJoin(customRoles, eq(customRoles.id, invites.customRoleId))
      .where(and(eq(invites.orgId, session.orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt), sql`${invites.expiresAt} > now()`))
      .orderBy(desc(invites.createdAt)),
    db
      .select({ id: users.customRoleId, n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.orgId, session.orgId), sql`${users.customRoleId} is not null`))
      .groupBy(users.customRoleId),
  ]);
  const peopleWith = new Map(counts.map((c) => [c.id, c.n]));
  const sites = await db
    .select({ id: facilities.id, name: facilities.name })
    .from(facilities)
    .where(eq(facilities.orgId, session.orgId))
    .orderBy(asc(facilities.name));

  // Only offer roles this person is allowed to hand out; the server checks again.
  const builtIn: RoleOption[] = ROLES.filter((r) => owner || (r !== "OWNER" && !permissionsFor(r).some((p) => OWNER_ONLY.includes(p)))).map((r) => ({
    value: `builtin:${r}`,
    label: ROLE_LABELS[r],
  }));
  const custom: RoleOption[] = roles
    .filter((r) => owner || !cleanPermissions(r.permissions).some((p) => OWNER_ONLY.includes(p)))
    .map((r) => ({ value: `custom:${r.id}`, label: r.name }));

  return (
    <>
      <PageHeader title="Team" subtitle="Invite people, choose what each of them can do, and build your own roles." />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="People">
            <ul className="divide-y divide-slate-100">
              {people.map((p) => {
                const current = p.customRoleId ? `custom:${p.customRoleId}` : `builtin:${p.role}`;
                const roleName = p.customName ?? ROLE_LABELS[p.role];
                const self = p.id === session.userId;
                const lockedForMe = !owner && p.role === "OWNER" && !p.customRoleId;
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className={`font-medium ${p.active ? "text-slate-900" : "text-slate-400 line-through"}`}>
                        {p.name} {self ? <span className="font-normal text-slate-500">(you)</span> : null}
                      </p>
                      <p className="truncate text-slate-600">{p.email}</p>
                      {!p.active ? <p className="text-xs font-semibold text-amber-700">Deactivated: can&apos;t sign in</p> : null}
                    </div>
                    {self || lockedForMe ? (
                      <span className="text-slate-700">{roleName}</span>
                    ) : (
                      <div className="flex flex-wrap items-start gap-2">
                        <ActionForm action={changeRoleAction} submitLabel="Change" quiet className="flex flex-wrap items-start gap-2">
                          <input type="hidden" name="userId" value={p.id} />
                          <select name="role" defaultValue={current} aria-label={`Role for ${p.name}`} className={inputBase}>
                            {[...builtIn, ...custom].some((o) => o.value === current) ? null : <option value={current}>{roleName}</option>}
                            <optgroup label="Built-in roles">
                              {builtIn.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </optgroup>
                            {custom.length ? (
                              <optgroup label="Your roles">
                                {custom.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
                          </select>
                        </ActionForm>
                        <ActionForm action={setActiveAction} submitLabel={p.active ? "Deactivate" : "Reactivate"} quiet className="flex items-start">
                          <input type="hidden" name="userId" value={p.id} />
                          <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                        </ActionForm>
                        {p.twoStep ? (
                          <ActionForm action={resetTwoFactorAction} submitLabel="Reset two-step" quiet className="flex items-start">
                            <input type="hidden" name="userId" value={p.id} />
                          </ActionForm>
                        ) : null}
                        {p.active ? <ResetLinkButton userId={p.id} name={p.name} action={resetLinkAction} /> : null}
                        {sites.length > 1 && !(p.role === "OWNER" && !p.customRoleId) ? (
                          <details className="w-full basis-full">
                            <summary className="cursor-pointer text-sm font-semibold text-brand-700">
                              Works at: {p.facilityIds?.length ? sites.filter((f) => p.facilityIds!.includes(f.id)).map((f) => f.name).join(", ") : "All facilities"}
                            </summary>
                            <ActionForm action={setFacilitiesAction} submitLabel="Save facilities" quiet className="mt-2 space-y-1">
                              <input type="hidden" name="userId" value={p.id} />
                              <label className="flex items-center gap-2">
                                <input type="checkbox" name="all" defaultChecked={!p.facilityIds?.length} className="h-4 w-4 accent-brand-700" />
                                All facilities, including new ones
                              </label>
                              {sites.map((f) => (
                                <label key={f.id} className="flex items-center gap-2 pl-6">
                                  <input
                                    type="checkbox"
                                    name="facilityIds"
                                    value={f.id}
                                    defaultChecked={Boolean(p.facilityIds?.includes(f.id))}
                                    aria-label={`${p.name} works at ${f.name}`}
                                    className="h-4 w-4 accent-brand-700"
                                  />
                                  {f.name}
                                </label>
                              ))}
                            </ActionForm>
                          </details>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <section id="roles" className="scroll-mt-20">
            <Card
              title="Roles"
              action={
                <Link href="/team/roles/new" className={buttonLinkClass}>
                  Build a role
                </Link>
              }
            >
              <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900 mb-3"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Built-in roles cover the usual jobs. Build your own when someone needs a different mix, such as a shift lead who can use the register and run counts.</span></p>
              {roles.length ? (
                <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {roles.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{r.name}</p>
                        <p className="text-slate-600">
                          {r.description || `${cleanPermissions(r.permissions).length} permissions`} · {peopleWith.get(r.id) ?? 0}{" "}
                          {(peopleWith.get(r.id) ?? 0) === 1 ? "person" : "people"}
                        </p>
                      </div>
                      <Link href={`/team/roles/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                        Edit
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">Built-in roles</summary>
                <ul className="mt-2 divide-y divide-slate-100">
                  {ROLES.map((r) => (
                    <li key={r} className="flex justify-between gap-3 py-2">
                      <span className="font-medium text-slate-900">{ROLE_LABELS[r]}</span>
                      <span className="text-right text-slate-600">{BUILT_IN_HINTS[r]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          </section>
        </div>

        <div className="space-y-5">
          <Card title="Invite someone">
            <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900 mb-3"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>You get a private link to send them by text or email. They open it, pick their own password, and they&apos;re in.</span></p>
            <InviteForm action={inviteAction} builtIn={builtIn} custom={custom} />
          </Card>
          <Card title="Waiting to join">
            {pending.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {pending.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{i.email}</p>
                      <p className="text-slate-600">
                        {i.customName ?? ROLE_LABELS[i.role]} · link expires {date(i.expiresAt, zone)}
                      </p>
                    </div>
                    <ActionForm action={revokeInviteAction} submitLabel="Cancel" quiet className="flex items-start">
                      <input type="hidden" name="inviteId" value={i.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No open invites.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
