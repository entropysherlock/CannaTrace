import "server-only";
import { INVITE_ONLY_MESSAGE } from "./access";
import { memberMaySignIn } from "./access-members";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { auditLogs, customRoles, facilities, invites, organizations, passwordResets, users } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";
import { OWNER_ONLY, ROLES, ROLE_LABELS, can, cleanPermissions, permissionsFor, type Permission, type Role } from "./rbac";
import { allowedFacilities } from "./facility-access";
import type { Session, SessionToken } from "./session";
import { checkEmail, checkPassword } from "./setup";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const INVITE_DAYS = 7;

/** A real owner: the built-in Owner role, not a custom role. Only owners can hand out team and API control. */
export function isOwner(session: Pick<Session, "role" | "customRoleId">): boolean {
  return session.role === "OWNER" && !session.customRoleId;
}

const hasOwnerOnly = (permissions: readonly Permission[]) => permissions.some((p) => OWNER_ONLY.includes(p));
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * No-escalation rule (APEX-11): someone who is not an owner can only hand out, change, or take over access that is
 * no more than their own, both in what people may do and in which facilities they may work at.
 */
const within = (wanted: readonly Permission[], own: readonly Permission[]) => wanted.every((p) => own.includes(p));
const facilitiesWithin = (wanted: readonly string[] | null, own: readonly string[] | null) =>
  own === null || (wanted !== null && wanted.every((id) => own.includes(id)));

function ownFacilities(session: Session): string[] | null {
  return allowedFacilities({ role: session.role, customRoleId: session.customRoleId, facilityIds: session.facilityIds });
}

function needTeamAccess(session: Session) {
  if (!can(session, "users.manage")) throw new InventoryError("Your role does not allow managing the team. Ask an owner.");
}

async function log(tx: Tx, session: Pick<Session, "orgId" | "userId" | "name">, entityType: string, entityId: string, action: string, after: object, before?: object) {
  await tx.insert(auditLogs).values({ orgId: session.orgId, userId: session.userId, userName: session.name, entityType, entityId, action, after, before });
}

export type RoleChoice = { role: Role; customRoleId: string | null; permissions: Permission[]; label: string };

/** Read a role picker value: "builtin:MANAGER" or "custom:<id>". */
export async function readRoleChoice(tx: Tx | typeof db, orgId: string, value: string): Promise<RoleChoice> {
  const [kind, key] = value.split(":");
  if (kind === "builtin" && (ROLES as string[]).includes(key)) {
    const role = key as Role;
    return { role, customRoleId: null, permissions: permissionsFor(role), label: ROLE_LABELS[role] };
  }
  if (kind === "custom" && key) {
    const [row] = await tx.select().from(customRoles).where(and(eq(customRoles.id, key), eq(customRoles.orgId, orgId)));
    if (row) return { role: "READ_ONLY", customRoleId: row.id, permissions: cleanPermissions(row.permissions), label: row.name };
  }
  throw new InventoryError("Choose a role.");
}

/** Whether this person may give someone the chosen role. */
function checkCanGrant(session: Session, choice: RoleChoice) {
  if ((choice.role === "OWNER" && !choice.customRoleId) || hasOwnerOnly(choice.permissions)) {
    if (!isOwner(session)) throw new InventoryError(`Only an owner can give someone the ${choice.label} role.`);
  }
  if (!isOwner(session) && !within(choice.permissions, session.permissions))
    throw new InventoryError(`You can only give a role that does no more than yours does. ${choice.label} can do things your role cannot.`);
}

// ---------- Invites ----------

export async function createInvite(session: Session, input: { email: string; roleChoice: string }): Promise<{ token: string; email: string; label: string }> {
  needTeamAccess(session);
  // An invited person starts with every facility, so someone limited to some facilities cannot invite (APEX-11).
  if (!isOwner(session) && ownFacilities(session) !== null) throw new InventoryError("Only someone who works at every facility can invite people. Ask an owner.");
  const email = checkEmail(input.email);
  return db.transaction(async (tx) => {
    const choice = await readRoleChoice(tx, session.orgId, input.roleChoice);
    checkCanGrant(session, choice);
    if ((await tx.$count(users, eq(users.email, email))) > 0)
      throw new InventoryError("Someone already has a Leaf2Sale account with that email.");
    // One open invite per person: a new one replaces the old link.
    await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.orgId, session.orgId), eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)));
    const token = randomBytes(32).toString("base64url");
    const [invite] = await tx
      .insert(invites)
      .values({
        orgId: session.orgId,
        email,
        role: choice.role,
        customRoleId: choice.customRoleId,
        tokenHash: hashToken(token),
        invitedBy: session.userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      })
      .returning({ id: invites.id });
    await log(tx, session, "Invite", invite.id, "CREATE", { email, role: choice.label });
    return { token, email, label: choice.label };
  });
}

export async function revokeInvite(session: Session, inviteId: string): Promise<void> {
  needTeamAccess(session);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.id, inviteId), eq(invites.orgId, session.orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .returning({ email: invites.email });
    if (!row) throw new InventoryError("That invite was already used or cancelled.");
    await log(tx, session, "Invite", inviteId, "REVOKE", { email: row.email });
  });
}

export type InviteView =
  | { status: "ok"; email: string; businessName: string; roleName: string }
  | { status: "missing" | "used" | "revoked" | "expired" };

/** What the invite page shows. Says nothing about the business unless the link is still good. */
export async function lookupInvite(token: string): Promise<InviteView> {
  const [row] = await db
    .select({ invite: invites, businessName: organizations.name, customName: customRoles.name })
    .from(invites)
    .innerJoin(organizations, eq(organizations.id, invites.orgId))
    .leftJoin(customRoles, eq(customRoles.id, invites.customRoleId))
    .where(eq(invites.tokenHash, hashToken(token)));
  if (!row) return { status: "missing" };
  const { invite } = row;
  if (invite.acceptedAt) return { status: "used" };
  if (invite.revokedAt) return { status: "revoked" };
  if (invite.expiresAt.getTime() < Date.now()) return { status: "expired" };
  return { status: "ok", email: invite.email, businessName: row.businessName, roleName: row.customName ?? ROLE_LABELS[invite.role] };
}

/** Turn an invite into an account. The link works once. */
export async function acceptInvite(token: string, input: { name: string; password: string }): Promise<SessionToken> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new InventoryError("Enter your name.");
  checkPassword(input.password);
  const passwordHash = await bcrypt.hash(input.password, 12);
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(invites).where(eq(invites.tokenHash, hashToken(token))).for("update");
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt.getTime() < Date.now())
      throw new InventoryError("This invite link no longer works. Ask for a new one.");
    // Invite-only: an invite works when the inviting business is on the list (its owner is), so owners can
    // bring on their staff. An invite from a business that isn't listed can't make an account.
    if (!(await memberMaySignIn(invite.email, invite.orgId, tx))) throw new InventoryError(INVITE_ONLY_MESSAGE);
    if (invite.customRoleId) {
      const exists = await tx.$count(customRoles, and(eq(customRoles.id, invite.customRoleId), eq(customRoles.orgId, invite.orgId)));
      if (!exists) throw new InventoryError("The role on this invite was removed. Ask for a new invite.");
    }
    if ((await tx.$count(users, eq(users.email, invite.email))) > 0)
      throw new InventoryError("An account with this email already exists. Sign in instead.");
    const [facility] = await tx
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.orgId, invite.orgId))
      .orderBy(asc(facilities.createdAt))
      .limit(1);
    if (!facility) throw new InventoryError("This business has no facility yet. Ask the owner to add one.");
    const [user] = await tx
      .insert(users)
      .values({ orgId: invite.orgId, email: invite.email, name, passwordHash, role: invite.role, customRoleId: invite.customRoleId })
      .returning();
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
    await log(tx, { orgId: invite.orgId, userId: user.id, name }, "User", user.id, "JOIN", { email: invite.email, inviteId: invite.id });
    return { userId: user.id, orgId: invite.orgId, facilityId: facility.id, role: user.role, name };
  });
}

// ---------- People ----------

async function lockTarget(tx: Tx, session: Session, userId: string) {
  if (userId === session.userId) throw new InventoryError("You cannot change your own role or access. Ask another owner.");
  const [target] = await tx
    .select({ user: users, customPermissions: customRoles.permissions })
    .from(users)
    .leftJoin(customRoles, eq(customRoles.id, users.customRoleId))
    .where(and(eq(users.id, userId), eq(users.orgId, session.orgId)))
    .for("update", { of: users });
  if (!target) throw new InventoryError("That person is not on your team.");
  const current = target.user.customRoleId ? cleanPermissions(target.customPermissions ?? []) : permissionsFor(target.user.role);
  if ((target.user.role === "OWNER" && !target.user.customRoleId) || hasOwnerOnly(current)) {
    if (!isOwner(session)) throw new InventoryError("Only an owner can change an owner or another team manager.");
  }
  if (!isOwner(session)) {
    if (!within(current, session.permissions)) throw new InventoryError("That person's role can do things yours cannot, so only an owner can change it.");
    const theirs = allowedFacilities({ role: target.user.role, customRoleId: target.user.customRoleId, facilityIds: target.user.facilityIds });
    if (!facilitiesWithin(theirs, ownFacilities(session))) throw new InventoryError("That person works at facilities you do not, so only an owner can change them.");
  }
  return target.user;
}

async function keepAnOwner(tx: Tx, orgId: string) {
  // Lock this business's owners so two owners cannot demote each other at the same moment.
  await tx.execute(sql`select id from users where org_id = ${orgId} and role = 'OWNER' for update`);
  const owners = await tx.$count(users, and(eq(users.orgId, orgId), eq(users.role, "OWNER"), isNull(users.customRoleId), eq(users.active, true)));
  if (owners < 1) throw new InventoryError("A business needs at least one active owner.");
}

export async function changeUserRole(session: Session, userId: string, roleChoice: string): Promise<void> {
  needTeamAccess(session);
  await db.transaction(async (tx) => {
    const target = await lockTarget(tx, session, userId);
    const choice = await readRoleChoice(tx, session.orgId, roleChoice);
    checkCanGrant(session, choice);
    await tx.update(users).set({ role: choice.role, customRoleId: choice.customRoleId }).where(eq(users.id, target.id));
    await keepAnOwner(tx, session.orgId);
    await log(tx, session, "User", target.id, "ROLE", { role: choice.label }, { role: target.role, customRoleId: target.customRoleId });
  });
}

/** Limit a person to some facilities, or give them every facility (an empty list). Owners always have every facility. */
export async function setUserFacilities(session: Session, userId: string, facilityIds: string[]): Promise<void> {
  needTeamAccess(session);
  await db.transaction(async (tx) => {
    const target = await lockTarget(tx, session, userId);
    if (target.role === "OWNER" && !target.customRoleId) throw new InventoryError("Owners always work at every facility.");
    const real = facilityIds.length
      ? (await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.orgId, session.orgId))).map((f) => f.id).filter((id) => facilityIds.includes(id))
      : [];
    if (facilityIds.length && real.length === 0) throw new InventoryError("Choose at least one facility, or All facilities.");
    if (!isOwner(session) && !facilitiesWithin(real.length ? real : null, ownFacilities(session)))
      throw new InventoryError("You can only give access to facilities you work at yourself.");
    await tx.update(users).set({ facilityIds: real.length ? real : null }).where(eq(users.id, target.id));
    await log(tx, session, "User", target.id, "FACILITIES", { facilityIds: real.length ? real : "all" }, { facilityIds: target.facilityIds ?? "all" });
  });
}

export async function setUserActive(session: Session, userId: string, active: boolean): Promise<void> {
  needTeamAccess(session);
  await db.transaction(async (tx) => {
    const target = await lockTarget(tx, session, userId);
    await tx.update(users).set({ active }).where(eq(users.id, target.id));
    await keepAnOwner(tx, session.orgId);
    await log(tx, session, "User", target.id, active ? "REACTIVATE" : "DEACTIVATE", { active });
  });
}

// ---------- Custom roles ----------

export async function saveCustomRole(
  session: Session,
  input: { id?: string; name: string; description: string; permissions: string[] },
): Promise<string> {
  needTeamAccess(session);
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new InventoryError("Give the role a name.");
  if (Object.values(ROLE_LABELS).some((label) => label.toLowerCase() === name.toLowerCase()))
    throw new InventoryError(`"${name}" is a built-in role name. Choose a different name.`);
  const permissions = cleanPermissions(input.permissions);
  if (permissions.length === 0) throw new InventoryError("Check at least one thing this role can do.");
  if (hasOwnerOnly(permissions) && !isOwner(session)) throw new InventoryError("Only an owner can build a role that manages the team or API keys.");
  if (!isOwner(session) && !within(permissions, session.permissions)) throw new InventoryError("You can only build a role that does no more than yours does.");
  const description = input.description.trim().slice(0, 300);

  return db.transaction(async (tx) => {
    const clash = await tx.$count(
      customRoles,
      and(eq(customRoles.orgId, session.orgId), sql`lower(${customRoles.name}) = ${name.toLowerCase()}`, input.id ? sql`${customRoles.id} <> ${input.id}` : undefined),
    );
    if (clash) throw new InventoryError(`You already have a role called "${name}".`);
    if (input.id) {
      const [before] = await tx.select().from(customRoles).where(and(eq(customRoles.id, input.id), eq(customRoles.orgId, session.orgId))).for("update");
      if (!before) throw new InventoryError("That role no longer exists.");
      if (hasOwnerOnly(cleanPermissions(before.permissions)) && !isOwner(session)) throw new InventoryError("Only an owner can change this role.");
      if (!isOwner(session) && !within(cleanPermissions(before.permissions), session.permissions)) throw new InventoryError("This role can do things yours cannot, so only an owner can change it.");
      if (session.customRoleId === before.id) throw new InventoryError("You cannot change the role you are using yourself. Ask an owner.");
      await tx.update(customRoles).set({ name, description, permissions }).where(eq(customRoles.id, before.id));
      await log(tx, session, "Role", before.id, "UPDATE", { name, permissions }, { name: before.name, permissions: before.permissions });
      return before.id;
    }
    const [row] = await tx.insert(customRoles).values({ orgId: session.orgId, name, description, permissions }).returning({ id: customRoles.id });
    await log(tx, session, "Role", row.id, "CREATE", { name, permissions });
    return row.id;
  });
}

export async function deleteCustomRole(session: Session, roleId: string): Promise<void> {
  needTeamAccess(session);
  await db.transaction(async (tx) => {
    const [role] = await tx.select().from(customRoles).where(and(eq(customRoles.id, roleId), eq(customRoles.orgId, session.orgId))).for("update");
    if (!role) throw new InventoryError("That role no longer exists.");
    if (hasOwnerOnly(cleanPermissions(role.permissions)) && !isOwner(session)) throw new InventoryError("Only an owner can delete this role.");
    if (!isOwner(session) && !within(cleanPermissions(role.permissions), session.permissions)) throw new InventoryError("This role can do things yours cannot, so only an owner can delete it.");
    const people = await tx.$count(users, eq(users.customRoleId, role.id));
    if (people) throw new InventoryError(`${people} ${people === 1 ? "person has" : "people have"} this role. Give them a different role first.`);
    // Open invites for this role stop working; used and cancelled ones keep their history.
    await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.customRoleId, role.id), isNull(invites.acceptedAt), isNull(invites.revokedAt)));
    await tx.update(invites).set({ customRoleId: null }).where(eq(invites.customRoleId, role.id));
    await tx.delete(customRoles).where(eq(customRoles.id, role.id));
    await log(tx, session, "Role", role.id, "DELETE", { name: role.name });
  });
}

// ---------- Passwords ----------

export const RESET_HOURS = 24;
/** Whole seconds, so a sign-in made in the same second as the change still counts (cookie times are in seconds). */
const changedNow = () => new Date(Math.floor(Date.now() / 1000) * 1000);

/**
 * A one-time link a manager hands to a team member who forgot their password. Same rules as
 * changing their access: owners' links come only from an owner, and never for yourself.
 */
export async function createPasswordReset(session: Session, userId: string): Promise<{ token: string; name: string; hours: number }> {
  needTeamAccess(session);
  return db.transaction(async (tx) => {
    const target = await lockTarget(tx, session, userId);
    if (!target.active) throw new InventoryError(`${target.name} is deactivated. Reactivate them first.`);
    // Only the newest link works.
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, target.id), isNull(passwordResets.usedAt)));
    const token = randomBytes(32).toString("base64url");
    await tx.insert(passwordResets).values({
      orgId: session.orgId,
      userId: target.id,
      tokenHash: hashToken(token),
      createdByName: session.name,
      expiresAt: new Date(Date.now() + RESET_HOURS * 3_600_000),
    });
    await log(tx, session, "User", target.id, "PASSWORD_RESET_LINK", { hours: RESET_HOURS });
    return { token, name: target.name, hours: RESET_HOURS };
  });
}

async function openReset(tx: Tx | typeof db, token: string, lock = false) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new InventoryError("This reset link isn't valid. Ask your manager for a new one.");
  const q = tx
    .select({ reset: passwordResets, user: users })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
  const [row] = lock ? await q.for("update", { of: passwordResets }) : await q;
  if (!row || !row.user.active || row.user.orgId !== row.reset.orgId) throw new InventoryError("This reset link has expired or was already used. Ask your manager for a new one.");
  return row;
}

export async function lookupReset(token: string): Promise<{ name: string; email: string }> {
  const { user } = await openReset(db, token);
  return { name: user.name, email: user.email };
}

/** Set a new password from a reset link. Every existing sign-in for that person stops working. */
export async function completeReset(token: string, password: string): Promise<{ email: string }> {
  checkPassword(password);
  const passwordHash = await bcrypt.hash(password, 12);
  return db.transaction(async (tx) => {
    const { reset, user } = await openReset(tx, token, true);
    await tx.update(users).set({ passwordHash, passwordChangedAt: changedNow() }).where(eq(users.id, user.id));
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
    await log(tx, { orgId: user.orgId, userId: user.id, name: user.name }, "User", user.id, "PASSWORD_RESET", { via: `link from ${reset.createdByName}` });
    return { email: user.email };
  });
}

/** Change your own password. Other devices are signed out; the caller re-issues this device's sign-in. */
export async function changeOwnPassword(session: Session, input: { current: string; next: string }): Promise<void> {
  if (session.support) throw new InventoryError("Support visits can't change a customer's password.");
  checkPassword(input.next);
  if (input.next === input.current) throw new InventoryError("Choose a password different from the current one.");
  const [user] = await db.select().from(users).where(and(eq(users.id, session.userId), eq(users.orgId, session.orgId), eq(users.active, true)));
  if (!user || !(await bcrypt.compare(input.current, user.passwordHash))) throw new InventoryError("Your current password isn't right.");
  const passwordHash = await bcrypt.hash(input.next, 12);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, passwordChangedAt: changedNow() }).where(eq(users.id, user.id));
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
    await log(tx, session, "User", user.id, "PASSWORD_CHANGE", {});
  });
}
