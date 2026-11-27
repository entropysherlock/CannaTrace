"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { and, eq, inArray } from "drizzle-orm";
import { packages } from "@/db/schema";
import { db } from "@/lib/db";
import { packagesWaitingOnLab } from "@/lib/pos";
import { isRetailStore } from "@/lib/store-setup";
import {
  COA_MAX_BYTES,
  InventoryError,
  addLabResult,
  adjustPackage,
  destroyPackage,
  destroyPackages,
  mergePackages,
  movePackage,
  movePackages,
  setPackageHarvestInfo,
  setPackagesStatus,
  receivePackage,
  recordCycleCount,
  setPackageStatus,
  splitPackage,
  type Actor,
  LAB_PROFILE,
} from "@/lib/inventory";
import { readReport } from "@/lib/importers/dutchie";
import { requirePermission, type Session } from "@/lib/session";
import { receiveShipment, type ShipmentResult } from "@/lib/shipments";
import type { Received } from "@/lib/shipments-parse";

function actorOf(session: Session): Actor {
  return {
    userId: session.userId,
    userName: session.name,
    orgId: session.orgId,
    facilityId: session.facilityId,
  };
}

export async function receiveAction(_state: FormState, formData: FormData): Promise<FormState> {
  let packageId: string;
  try {
    const session = await requirePermission("inventory.write");
    const pkg = await receivePackage(actorOf(session), {
      tag: field(formData, "tag"),
      itemId: field(formData, "itemId"),
      quantity: field(formData, "quantity"),
      locationId: field(formData, "locationId"),
      lotNumber: field(formData, "lotNumber"),
      harvestName: field(formData, "harvestName"),
      harvestDate: field(formData, "harvestDate"),
      costPerUnit: field(formData, "costPerUnit"),
      note: field(formData, "note"),
      vendorId: field(formData, "vendorId") || null,
    });
    packageId = pkg.id;
  } catch (error) {
    return toFormError(error);
  }
  revalidatePath("/inventory");
  redirect(`/inventory/${packageId}`);
}

export async function harvestInfoAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.write");
    const packageId = field(formData, "packageId");
    await setPackageHarvestInfo(actorOf(session), { packageId, harvestName: field(formData, "harvestName"), harvestDate: field(formData, "harvestDate") });
    revalidatePath(`/inventory/${packageId}`);
    return { ok: "Harvest info saved. Labels will use it." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function moveAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.write");
    const packageId = field(formData, "packageId");
    await movePackage(actorOf(session), {
      packageId,
      toLocationId: field(formData, "toLocationId"),
      note: field(formData, "note"),
    });
    revalidatePath(`/inventory/${packageId}`);
    return { ok: "Package moved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function adjustAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.adjust");
    const packageId = field(formData, "packageId");
    await adjustPackage(actorOf(session), {
      packageId,
      newQuantity: field(formData, "newQuantity"),
      reasonCode: field(formData, "reasonCode"),
      note: field(formData, "note"),
      approver: session.role === "OWNER" || session.role === "MANAGER",
    });
    revalidatePath(`/inventory/${packageId}`);
    return { ok: "Quantity adjusted and logged." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function splitAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.write");
    const packageId = field(formData, "packageId");
    const tags = formData.getAll("tag").map(String);
    const quantities = formData.getAll("quantity").map(String);
    const parts = tags
      .map((tag, i) => ({ tag: tag.trim(), quantity: (quantities[i] ?? "").trim() }))
      .filter((part) => part.tag || part.quantity);
    const { children } = await splitPackage(actorOf(session), { packageId, parts, note: field(formData, "note") });
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${packageId}`);
    return { ok: `Created ${children.map((c) => c.tag).join(", ")}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function mergeAction(_state: FormState, formData: FormData): Promise<FormState> {
  let mergedId: string;
  try {
    const session = await requirePermission("inventory.write");
    const packageId = field(formData, "packageId");
    const otherTags = field(formData, "otherTags")
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (otherTags.length === 0) throw new InventoryError("Scan or type at least one other package tag to merge with.");
    const others = await db
      .select({ id: packages.id, tag: packages.tag })
      .from(packages)
      .where(
        and(
          eq(packages.orgId, session.orgId),
          eq(packages.facilityId, session.facilityId),
          inArray(packages.tag, otherTags),
        ),
      );
    const found = new Set(others.map((o) => o.tag));
    const missing = otherTags.filter((t) => !found.has(t));
    if (missing.length) throw new InventoryError(`No package with tag ${missing.join(", ")} at this facility.`);
    const merged = await mergePackages(actorOf(session), {
      sourceIds: [packageId, ...others.map((o) => o.id)],
      newTag: field(formData, "newTag"),
      note: field(formData, "note"),
    });
    mergedId = merged.id;
  } catch (error) {
    return toFormError(error);
  }
  revalidatePath("/inventory");
  redirect(`/inventory/${mergedId}`);
}

export async function statusAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.adjust");
    const packageId = field(formData, "packageId");
    const status = field(formData, "status");
    const reason = field(formData, "reason");
    if (status === "DESTROYED") {
      await destroyPackage(actorOf(session), {
        packageId,
        reason,
        mixedConfirmed: field(formData, "mixedConfirmed") === "yes",
        videoCamera: field(formData, "videoCamera"),
        videoRecordedAt: field(formData, "videoRecordedAt"),
        witnessName: field(formData, "witnessName"),
      });
    } else {
      await setPackageStatus(actorOf(session), { packageId, status, reason });
    }
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${packageId}`);
    return { ok: "Status updated and logged." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function labResultAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.write");
    const packageId = field(formData, "packageId");
    const file = formData.get("coa");
    let coa: { name: string; type: string; data: Buffer } | null = null;
    if (file instanceof File && file.size > 0) {
      if (session.isDemo) throw new InventoryError("File uploads are switched off in the live demo. Save the result without the COA file.");
      if (file.size > COA_MAX_BYTES) throw new InventoryError("The COA file is larger than 4 MB. Compress it and try again.");
      coa = { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) };
    }
    const result = await addLabResult(actorOf(session), {
      packageId,
      labName: field(formData, "labName"),
      status: field(formData, "status"),
      sampleDate: field(formData, "sampleDate"),
      thcPercent: field(formData, "thcPercent"),
      cbdPercent: field(formData, "cbdPercent"),
      profile: Object.fromEntries(LAB_PROFILE.map(({ key }) => [key, field(formData, key)])),
      terpenes: field(formData, "terpenes"),
      notes: field(formData, "notes"),
      coa,
      alsoPackageIds: formData.getAll("alsoPackageId").map(String),
    });
    revalidatePath("/inventory", "layout");
    if (result.recorded > 1) {
      return {
        ok: `Result saved for ${result.recorded} packages.${result.quarantinedCount ? ` ${result.quarantinedCount} failed and ${result.quarantinedCount === 1 ? "is" : "are"} now quarantined.` : ""}`,
      };
    }
    return { ok: result.quarantined ? "Result saved. The package failed and is now quarantined." : "Result saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function cycleCountAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.adjust");
    const locationId = field(formData, "locationId");
    const counts = formData
      .getAll("packageId")
      .map(String)
      .map((packageId) => ({ packageId, counted: field(formData, `counted:${packageId}`) }));
    const result = await recordCycleCount(actorOf(session), { locationId, counts });
    revalidatePath("/inventory");
    revalidatePath("/counts");
    revalidatePath(`/counts/${locationId}`);
    return {
      ok:
        result.variances === 0
          ? `Count saved. All ${result.packagesCounted} packages matched.`
          : `Count saved. ${result.variances} of ${result.packagesCounted} packages were corrected.`,
    };
  } catch (error) {
    return toFormError(error);
  }
}

// ---------- Receiving a whole shipment against its manifest ----------

export type ShipmentState = { error?: string; result?: ShipmentResult } | null;

async function shipmentInput(formData: FormData, commit: boolean) {
  const session = await requirePermission("inventory.write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new InventoryError("Choose the manifest file (CSV or Excel).");
  const table = await readReport(file.name, Buffer.from(await file.arrayBuffer()));
  let received: Record<string, Received> = {};
  try {
    const raw = field(formData, "received");
    received = raw ? (JSON.parse(raw) as Record<string, Received>) : {};
  } catch {
    throw new InventoryError("The received counts couldn't be read. Check the manifest again.");
  }
  return receiveShipment(actorOf(session), {
    manifestNumber: field(formData, "manifestNumber"),
    table,
    locationId: field(formData, "locationId"),
    vendorId: field(formData, "vendorId") || null,
    received,
    commit,
  });
}

/** Check a manifest against what arrived. Nothing is saved. */
export async function checkShipmentAction(formData: FormData): Promise<ShipmentState> {
  try {
    return { result: await shipmentInput(formData, false) };
  } catch (error) {
    return { error: error instanceof InventoryError ? error.message : "The manifest couldn't be checked. Try again." };
  }
}

/** Receive the shipment: everything on it that arrived, all at once, or nothing. */
export async function receiveShipmentAction(formData: FormData): Promise<ShipmentState> {
  try {
    const result = await shipmentInput(formData, true);
    if (result.received) {
      revalidatePath("/inventory");
      revalidatePath("/compliance");
    }
    return { result };
  } catch (error) {
    return { error: error instanceof InventoryError ? error.message : "The shipment couldn't be received. Nothing was saved." };
  }
}

/** The check-and-apply bar on Inventory → Packages: move, hold, quarantine, release, or print labels for many at once. */
export async function packageBulkAction(_state: FormState, formData: FormData): Promise<FormState> {
  const ids = formData.getAll("packageId").map(String).filter(Boolean);
  const action = field(formData, "bulkAction");
  if (action === "LABELS") {
    // Printing only needs the labels permission; the label page checks it again.
    await requirePermission("labels.print");
    if (!ids.length) return { error: "Check at least one package first." };
    redirect(`/labels?kind=PACKAGE&ids=${ids.slice(0, 1000).join(",")}`);
  }
  const plural = (n: number) => `${n} package${n === 1 ? "" : "s"}`;
  try {
    const session = await requirePermission("inventory.write");
    const actor = actorOf(session);
    let message: string;
    if (action === "MOVE") {
      const r = await movePackages(actor, { packageIds: ids, toLocationId: field(formData, "toLocationId"), note: field(formData, "note") });
      message = `${plural(r.moved)} moved.${r.alreadyThere ? ` ${plural(r.alreadyThere)} ${r.alreadyThere === 1 ? "was" : "were"} already there.` : ""}`;
    } else if (action === "ON_HOLD" || action === "QUARANTINE" || action === "ACTIVE") {
      const r = await setPackagesStatus(actor, { packageIds: ids, status: action, reason: field(formData, "reason") });
      const words = action === "ACTIVE" ? "released" : action === "ON_HOLD" ? "put on hold" : "put in quarantine";
      message = `${plural(r.changed)} ${words}.${r.already ? ` ${plural(r.already)} ${r.already === 1 ? "was" : "were"} already ${action === "ACTIVE" ? "active" : action === "ON_HOLD" ? "on hold" : "in quarantine"}.` : ""}`;
    } else if (action === "DESTROYED") {
      // Destroying is a bigger step than a hold, so it needs the adjust permission the single-package form needs.
      const adjuster = await requirePermission("inventory.adjust");
      const r = await destroyPackages(actorOf(adjuster), {
        packageIds: ids,
        reason: field(formData, "reason"),
        mixedConfirmed: field(formData, "mixedConfirmed") === "yes",
        videoCamera: field(formData, "videoCamera"),
        videoRecordedAt: field(formData, "videoRecordedAt"),
        witnessName: field(formData, "witnessName"),
      });
      message = `${plural(r.destroyed)} destroyed. Each one has its own record with the camera and time.`;
    } else {
      return { error: "Choose what to do with the checked packages." };
    }
    revalidatePath("/inventory", "layout");
    return { ok: message };
  } catch (error) {
    return toFormError(error);
  }
}

/** One click on Inventory: put every package that has no passing lab result on hold until its result is recorded. */
export async function holdWaitingOnLabAction(_state: FormState, _formData: FormData): Promise<FormState> {
  try {
    const session = await requirePermission("inventory.write");
    const actor = actorOf(session);
    if (!(await isRetailStore(actor.orgId, actor.facilityId))) return { error: "This is only for stores that sell at a register. Packages at a grow or lab wait on results as a normal part of the process." };
    const ids = await packagesWaitingOnLab(db, actor);
    if (!ids.length) return { ok: "Nothing to hold. Every active package already has a passing lab result." };
    let changed = 0;
    // The bulk hold takes at most BULK_LIMIT at a time, so a big import goes through in batches.
    for (let i = 0; i < ids.length; i += 200) {
      const r = await setPackagesStatus(actor, {
        packageIds: ids.slice(i, i + 200),
        status: "ON_HOLD",
        reason: "Held until a passing lab result is recorded",
      });
      changed += r.changed;
    }
    revalidatePath("/inventory", "layout");
    return { ok: `${changed} package${changed === 1 ? "" : "s"} put on hold. Add each lab result, then release it.` };
  } catch (error) {
    return toFormError(error);
  }
}
