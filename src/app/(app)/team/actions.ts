"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { requirePermission } from "@/lib/session";
import { changeUserRole, createInvite, deleteCustomRole, revokeInvite, saveCustomRole, setUserActive } from "@/lib/team";

export type InviteState = (FormState & { link?: string }) | null;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function inviteAction(_state: InviteState, formData: FormData): Promise<InviteState> {
  try {
    const session = await requirePermission("users.manage");
    const invite = await createInvite(session, { email: field(formData, "email"), roleChoice: field(formData, "role") });
    revalidatePath("/team");
    return {
      ok: `Invite ready for ${invite.email} as ${invite.label}. Send them this link. It works once and expires in 7 days.`,
      link: `${await siteOrigin()}/invite/${invite.token}`,
    };
  } catch (error) {
    return toFormError(error);
  }
}

export async function revokeInviteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await revokeInvite(await requirePermission("users.manage"), field(formData, "inviteId"));
    revalidatePath("/team");
    return { ok: "Invite cancelled." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function changeRoleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await changeUserRole(await requirePermission("users.manage"), field(formData, "userId"), field(formData, "role"));
    revalidatePath("/team");
    return { ok: "Role changed. It applies right away." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function setActiveAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const active = field(formData, "active") === "true";
    await setUserActive(await requirePermission("users.manage"), field(formData, "userId"), active);
    revalidatePath("/team");
    return { ok: active ? "They can sign in again." : "Switched off. They are signed out and cannot sign in." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function saveRoleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("users.manage");
    await saveCustomRole(session, {
      id: field(formData, "id") || undefined,
      name: field(formData, "name"),
      description: field(formData, "description"),
      permissions: formData.getAll("permissions").map(String),
    });
    revalidatePath("/team");
  } catch (error) {
    return toFormError(error);
  }
  redirect("/team#roles");
}

export async function deleteRoleAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await deleteCustomRole(await requirePermission("users.manage"), field(formData, "id"));
    revalidatePath("/team");
  } catch (error) {
    return toFormError(error);
  }
  redirect("/team#roles");
}
