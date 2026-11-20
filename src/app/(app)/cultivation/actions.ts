"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changePlantPhase,
  completeTask,
  createPlantBatch,
  createStrain,
  createTask,
  destroyBatchPlants,
  destroyPlants,
  findStrainByName,
  finishHarvest,
  reopenHarvest,
  harvestPlants,
  logHarvestWaste,
  movePlants,
  packageHarvestMany,
  recordDryWeight,
  tagPlants,
} from "@/lib/cultivation";
import { toCreateError, type CreateResult } from "@/lib/contextual-create";
import { expandTags, parseTagList } from "@/lib/cultivation-math";
import { field, toFormError, type FormState } from "@/lib/form";
import { InventoryError, type Actor } from "@/lib/inventory";
import { requirePermission } from "@/lib/session";

async function cultivationActor(): Promise<Actor> {
  const session = await requirePermission("cultivation.write");
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export async function strainAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const name = field(formData, "name");
    await createStrain(await cultivationActor(), {
      name,
      type: field(formData, "type"),
      floweringDays: field(formData, "floweringDays"),
    });
    revalidatePath("/cultivation", "layout");
    return { ok: `Added ${name}.` };
  } catch (error) {
    return toFormError(error);
  }
}

// ---- Create without leaving: prerequisites added from inside the Start a batch form ----

/** Add a strain from the batch form. Same checks, rules, and audit entry as the Strains tab. */
export async function quickStrainAction(formData: FormData): Promise<CreateResult> {
  try {
    const actor = await cultivationActor();
    const name = field(formData, "name");
    const twin = await findStrainByName(actor.orgId, name);
    if (twin?.active) return { existing: { id: twin.id, label: twin.name } };
    if (twin) return { error: `A strain called ${twin.name} is already on file but turned off, so it can't be picked. Use a different name.` };
    const strain = await createStrain(actor, { name, type: field(formData, "type"), floweringDays: field(formData, "floweringDays") });
    revalidatePath("/cultivation", "layout");
    return { created: { id: strain.id, label: name.replace(/\s+/g, " ") } };
  } catch (error) {
    return toCreateError(error);
  }
}

export async function batchAction(_state: FormState, formData: FormData): Promise<FormState> {
  let batchId: string;
  try {
    const batch = await createPlantBatch(await cultivationActor(), {
      name: field(formData, "name"),
      strainId: field(formData, "strainId"),
      source: field(formData, "source"),
      count: field(formData, "count"),
      locationId: field(formData, "locationId"),
    });
    batchId = batch.id;
  } catch (error) {
    return toFormError(error);
  }
  revalidatePath("/cultivation", "layout");
  redirect(`/cultivation/batches/${batchId}`);
}

export async function tagPlantsAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await cultivationActor();
    const batchId = field(formData, "batchId");
    const list = field(formData, "tagList");
    const first = field(formData, "firstTag");
    const count = Number(field(formData, "count"));
    // A list of tags, a roll (first tag and a count), or, with both left blank, generated tags.
    const created = await tagPlants(actor, {
      batchId,
      ...(list ? { tags: parseTagList(list) } : first ? { tags: expandTags(first, count) } : { generate: count }),
      locationId: field(formData, "locationId"),
    });
    revalidatePath("/cultivation", "layout");
    const tags = created.map((p) => p.tag).sort();
    return { ok: `Tagged ${plural(created.length, "plant")}: ${tags[0]}${tags.length > 1 ? ` to ${tags[tags.length - 1]}` : ""}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function destroyBatchAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await destroyBatchPlants(await cultivationActor(), {
      batchId: field(formData, "batchId"),
      count: field(formData, "count"),
      reason: field(formData, "reason"),
      wasteGrams: field(formData, "waste"),
      wasteUnit: field(formData, "wasteUnit") || "G",
    });
    revalidatePath("/cultivation", "layout");
    return { ok: "Recorded and logged." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function plantBulkAction(_state: FormState, formData: FormData): Promise<FormState> {
  let harvestId: string | null = null;
  let message = "";
  try {
    const actor = await cultivationActor();
    const plantIds = formData.getAll("plantId").map(String);
    if (plantIds.length === 0) throw new InventoryError("Tick at least one plant first.");
    const action = field(formData, "bulkAction");
    if (action === "FLOWERING" || action === "VEGETATIVE") {
      const changed = await changePlantPhase(actor, { plantIds, phase: action });
      message = `${plural(changed, "plant")} moved to ${action.toLowerCase()}.`;
    } else if (action === "MOVE") {
      const moved = await movePlants(actor, { plantIds, locationId: field(formData, "locationId") });
      message = `${plural(moved, "plant")} moved.`;
    } else if (action === "DESTROY") {
      const destroyed = await destroyPlants(actor, {
        plantIds,
        reason: field(formData, "reason"),
        wasteGrams: field(formData, "waste"),
        wasteUnit: field(formData, "wasteUnit") || "G",
      });
      message = `${plural(destroyed, "plant")} destroyed and logged.`;
    } else if (action === "HARVEST") {
      const harvest = await harvestPlants(actor, {
        plantIds,
        name: field(formData, "harvestName"),
        wetWeight: field(formData, "wetWeight"),
        unit: field(formData, "wetUnit") || "G",
        locationId: field(formData, "dryLocationId"),
      });
      harvestId = harvest.id;
    } else {
      throw new InventoryError("Choose what to do with the selected plants.");
    }
  } catch (error) {
    return toFormError(error);
  }
  revalidatePath("/cultivation", "layout");
  if (harvestId) redirect(`/cultivation/harvests/${harvestId}`);
  return { ok: message };
}

export async function dryWeightAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await recordDryWeight(await cultivationActor(), {
      harvestId: field(formData, "harvestId"),
      dryWeight: field(formData, "weight"),
      unit: field(formData, "unit") || "G",
    });
    revalidatePath("/cultivation", "layout");
    return { ok: "Dry weight saved." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function wasteAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await logHarvestWaste(await cultivationActor(), {
      harvestId: field(formData, "harvestId"),
      weight: field(formData, "weight"),
      unit: field(formData, "unit") || "G",
      reason: field(formData, "reason"),
    });
    revalidatePath("/cultivation", "layout");
    return { ok: "Waste logged." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function packageHarvestAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const made = await packageHarvestMany(await cultivationActor(), {
      harvestId: field(formData, "harvestId"),
      tag: field(formData, "tag"),
      itemId: field(formData, "itemId"),
      quantity: field(formData, "quantity"),
      locationId: field(formData, "locationId"),
      count: field(formData, "count") || "1",
    });
    revalidatePath("/cultivation", "layout");
    revalidatePath("/inventory");
    if (made.length === 1) return { ok: `Created package ${made[0].tag}.` };
    return { ok: `Created ${made.length} packages: ${made[0].tag} to ${made[made.length - 1].tag}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function reopenHarvestAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const reason = field(formData, "reason").trim();
    if (!reason) return { error: "Say why the harvest is being reopened." };
    await reopenHarvest(await cultivationActor(), { harvestId: field(formData, "harvestId"), reason });
    revalidatePath("/cultivation", "layout");
    return { ok: "Harvest reopened." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function finishHarvestAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await finishHarvest(await cultivationActor(), { harvestId: field(formData, "harvestId") });
    revalidatePath("/cultivation", "layout");
    return { ok: "Harvest finished." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function taskAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    await createTask(await cultivationActor(), {
      title: field(formData, "title"),
      dueDate: field(formData, "dueDate"),
      locationId: field(formData, "locationId"),
    });
    revalidatePath("/cultivation/overview");
    return { ok: "Task added." };
  } catch (error) {
    return toFormError(error);
  }
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  await completeTask(await cultivationActor(), { taskId: field(formData, "taskId") });
  revalidatePath("/cultivation/overview");
}
