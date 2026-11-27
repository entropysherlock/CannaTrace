"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import type { Actor } from "@/lib/inventory";
import { deleteBoost, deleteTier, saveBoost, saveMarketingSettings, saveTier, setShopperConsent, updateShopperProfile } from "@/lib/loyalty";
import { createCampaign, deleteCampaign, removeSponsorship, saveAutomation, saveSponsorship, sendCampaign, updateCampaign } from "@/lib/marketing";
import { requirePermission } from "@/lib/session";

async function manager(): Promise<Actor> {
  const session = await requirePermission("pos.manage");
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}
const refresh = () => revalidatePath("/marketing", "layout");

export async function profileAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const memberId = field(formData, "memberId");
    await updateShopperProfile(await manager(), { memberId, email: field(formData, "email"), tags: field(formData, "tags"), notes: field(formData, "notes") });
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function consentAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const channel = field(formData, "channel") === "SMS" ? "SMS" : "EMAIL";
    await setShopperConsent(await manager(), { memberId: field(formData, "memberId"), channel, agreed: field(formData, "agreed") === "yes" });
    refresh();
    return { ok: "Saved. The change is kept in the shopper's consent record." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function tierAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveTier(await manager(), Object.fromEntries(formData.entries()));
    refresh();
    return { ok: "Tier saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function tierDeleteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await deleteTier(await manager(), { tierId: field(formData, "tierId") });
    refresh();
    return { ok: "Tier removed." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function boostAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveBoost(await manager(), Object.fromEntries(formData.entries()));
    refresh();
    return { ok: "Bonus-points days saved. The register uses them automatically." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function boostDeleteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await deleteBoost(await manager(), { boostId: field(formData, "boostId") });
    refresh();
    return { ok: "Removed." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function marketingSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveMarketingSettings(await manager(), Object.fromEntries(formData.entries()));
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function campaignCreateAction(_state: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    id = (await createCampaign(await manager(), Object.fromEntries(formData.entries()))).id;
    refresh();
  } catch (error) {
    return toFormError(error);
  }
  redirect(`/marketing/campaigns/${id}`);
}

export async function campaignUpdateAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await updateCampaign(await manager(), field(formData, "campaignId"), Object.fromEntries(formData.entries()));
    refresh();
    return { ok: "Saved. The check below is up to date." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function campaignSendAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    if (field(formData, "confirm").toUpperCase() !== "SEND") return { error: "Type SEND to confirm. A sent message can't be recalled." };
    const result = await sendCampaign(await manager(), field(formData, "campaignId"));
    refresh();
    return { ok: `Sent to ${result.sent} shopper${result.sent === 1 ? "" : "s"}.${result.skipped ? ` ${result.skipped} left out by a rule.` : ""}${result.failed ? ` ${result.failed} failed.` : ""}` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function campaignDeleteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await deleteCampaign(await manager(), field(formData, "campaignId"));
    refresh();
  } catch (error) {
    return toFormError(error);
  }
  redirect("/marketing/campaigns");
}

export async function automationAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveAutomation(await manager(), Object.fromEntries(formData.entries()));
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function sponsorshipAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveSponsorship(await manager(), { promoId: field(formData, "promoId"), brandName: field(formData, "brandName"), fundedPercent: field(formData, "fundedPercent"), note: field(formData, "note") });
    refresh();
    return { ok: "Saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function sponsorshipRemoveAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await removeSponsorship(await manager(), { promoId: field(formData, "promoId") });
    refresh();
    return { ok: "Removed." };
  } catch (error) {
    return toFormError(error);
  }
}
