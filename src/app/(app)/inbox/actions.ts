"use server";

import { revalidatePath } from "next/cache";
import { toFormError } from "@/lib/form";
import { applyHarvestSheet, applyInvoice, applyLicense, applyPriceList, applyWholesaleOrder } from "@/lib/scan/apply";
import { receiveManifest, type ManifestLine } from "@/lib/scan/manifest";
import { confirmCoa, dismissScan } from "@/lib/scan/read";
import type { CoaValues } from "@/lib/scan/types";
import { requireSession } from "@/lib/session";

export type ConfirmResult = { ok: true; resultId: string; packageId: string; quarantined: boolean } | { ok: false; error: string };

export async function confirmCoaAction(input: { attachmentId: string; packageId: string; values: Partial<CoaValues> }): Promise<ConfirmResult> {
  try {
    const session = await requireSession();
    const saved = await confirmCoa(session, input);
    // Not "/inbox": that would swap this review page for "already saved" before the person sees the success screen.
    revalidatePath("/inventory");
    return { ok: true, resultId: saved.resultId, packageId: input.packageId, quarantined: saved.quarantined };
  } catch (error) {
    const failed = toFormError(error);
    return { ok: false, error: failed && "error" in failed && failed.error ? failed.error : "That couldn't be saved." };
  }
}

export async function dismissScanAction(attachmentId: string): Promise<void> {
  await dismissScan(await requireSession(), attachmentId);
  revalidatePath("/inbox");
}

export type ReceiveManifestResult = { ok: true; count: number } | { ok: false; error: string };

export async function receiveManifestAction(input: { attachmentId: string; locationId: string; vendorId: string; lines: ManifestLine[] }): Promise<ReceiveManifestResult> {
  try {
    const session = await requireSession();
    const done = await receiveManifest(session, input);
    revalidatePath("/inventory");
    return { ok: true, count: done.count };
  } catch (error) {
    const failed = toFormError(error);
    return { ok: false, error: failed && "error" in failed && failed.error ? failed.error : "That couldn't be received." };
  }
}

type Failed = { ok: false; error: string };
const failure = (error: unknown, fallback: string): Failed => {
  const failed = toFormError(error);
  return { ok: false, error: failed && "error" in failed && failed.error ? failed.error : fallback };
};

export async function applyInvoiceAction(input: Parameters<typeof applyInvoice>[1]): Promise<{ ok: true; count: number } | Failed> {
  try {
    const done = await applyInvoice(await requireSession(), input);
    revalidatePath("/inventory");
    return { ok: true, count: done.count };
  } catch (error) {
    return failure(error, "Those costs couldn't be saved.");
  }
}

export async function applyHarvestSheetAction(input: Parameters<typeof applyHarvestSheet>[1]): Promise<{ ok: true; harvestId: string; plants: number } | Failed> {
  try {
    const done = await applyHarvestSheet(await requireSession(), input);
    revalidatePath("/cultivation", "layout");
    return { ok: true, ...done };
  } catch (error) {
    return failure(error, "That harvest couldn't be recorded.");
  }
}

export async function applyLicenseAction(input: Parameters<typeof applyLicense>[1]): Promise<{ ok: true; label: string; expires: string } | Failed> {
  try {
    const done = await applyLicense(await requireSession(), input);
    revalidatePath("/dashboard");
    revalidatePath("/distribution", "layout");
    return { ok: true, ...done };
  } catch (error) {
    return failure(error, "That license date couldn't be saved.");
  }
}

export async function applyPriceListAction(input: Parameters<typeof applyPriceList>[1]): Promise<{ ok: true; prices: number; created: number; listName: string } | Failed> {
  try {
    const done = await applyPriceList(await requireSession(), input);
    revalidatePath("/catalog");
    revalidatePath("/distribution", "layout");
    return { ok: true, ...done };
  } catch (error) {
    return failure(error, "Those prices couldn't be saved.");
  }
}

export async function applyWholesaleOrderAction(input: Parameters<typeof applyWholesaleOrder>[1]): Promise<{ ok: true; orderId: string; number: string; added: number; problems: string[] } | Failed> {
  try {
    const done = await applyWholesaleOrder(await requireSession(), input);
    revalidatePath("/distribution", "layout");
    return { ok: true, ...done };
  } catch (error) {
    return failure(error, "That order couldn't be created.");
  }
}
