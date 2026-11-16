"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, toFormError, type FormState } from "@/lib/form";
import type { Actor } from "@/lib/inventory";
import { addRunInput, cancelRun, completeRun, createRecipe, removeRunInput, setRecipeActive, startRun } from "@/lib/manufacturing";
import { requirePermission } from "@/lib/session";

async function maker(): Promise<Actor> {
  const session = await requirePermission("manufacturing.write");
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}

export async function recipeAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const itemIds = formData.getAll("inputItemId").map(String);
    const quantities = formData.getAll("inputQuantity").map(String);
    const lines = itemIds
      .map((itemId, i) => ({ itemId, quantity: (quantities[i] ?? "").trim() }))
      .filter((line) => line.itemId || line.quantity);
    const name = field(formData, "name");
    await createRecipe(await maker(), {
      name,
      outputItemId: field(formData, "outputItemId"),
      outputQuantity: field(formData, "outputQuantity"),
      lines,
    });
    revalidatePath("/manufacturing", "layout");
    return { ok: `Saved recipe ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function recipeActiveAction(formData: FormData): Promise<void> {
  await setRecipeActive(await maker(), { recipeId: field(formData, "recipeId"), active: field(formData, "active") === "true" });
  revalidatePath("/manufacturing", "layout");
}

export async function startRunAction(_state: FormState, formData: FormData): Promise<FormState> {
  let runId: string;
  try {
    const run = await startRun(await maker(), {
      name: field(formData, "name"),
      recipeId: field(formData, "recipeId"),
      batches: field(formData, "batches"),
    });
    runId = run.id;
  } catch (error) {
    return toFormError(error);
  }
  revalidatePath("/manufacturing", "layout");
  redirect(`/manufacturing/runs/${runId}`);
}

export async function addInputAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const result = await addRunInput(await maker(), {
      runId: field(formData, "runId"),
      tag: field(formData, "tag"),
      quantity: field(formData, "quantity"),
    });
    revalidatePath("/manufacturing", "layout");
    revalidatePath("/inventory");
    return { ok: `Added from ${result.tag}. ${result.remaining} left in that package.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function removeInputAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await removeRunInput(await maker(), { inputId: field(formData, "inputId") });
    revalidatePath("/manufacturing", "layout");
    revalidatePath("/inventory");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function completeRunAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await completeRun(await maker(), {
      runId: field(formData, "runId"),
      outputTag: field(formData, "outputTag"),
      actualQuantity: field(formData, "actualQuantity"),
      locationId: field(formData, "locationId"),
      extraCost: field(formData, "extraCost"),
      lossNote: field(formData, "lossNote"),
    });
    revalidatePath("/manufacturing", "layout");
    revalidatePath("/inventory");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}

export async function cancelRunAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await cancelRun(await maker(), { runId: field(formData, "runId") });
    revalidatePath("/manufacturing", "layout");
    return null;
  } catch (error) {
    return toFormError(error);
  }
}
