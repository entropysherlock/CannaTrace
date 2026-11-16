"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import { and, eq, inArray } from "drizzle-orm";
import { packages } from "@/db/schema";
import { db } from "@/lib/db";
import {
  COA_MAX_BYTES,
  InventoryError,
  addLabResult,
  adjustPackage,
  destroyPackage,
  mergePackages,
  movePackage,
  receivePackage,
  recordCycleCount,
  setPackageStatus,
  splitPackage,
  type Actor,
} from "@/lib/inventory";
import { requirePermission, type Session } from "@/lib/session";

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
      costPerUnit: field(formData, "costPerUnit"),
      note: field(formData, "note"),
    });
    packageId = pkg.id;
  } catch (error) {
    return toFormError(error);
  }
  revalidatePath("/inventory");
  redirect(`/inventory/${packageId}`);
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
      await destroyPackage(actorOf(session), { packageId, reason });
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
      notes: field(formData, "notes"),
      coa,
    });
    revalidatePath(`/inventory/${packageId}`);
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
