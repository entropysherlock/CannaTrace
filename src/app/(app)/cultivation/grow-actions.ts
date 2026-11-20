"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { strains } from "@/db/schema";
import { changePlantPhase, createPlantBatch, harvestPlants, movePlants } from "@/lib/cultivation";
import { db } from "@/lib/db";
import { field, toFormError, type FormState } from "@/lib/form";
import { InventoryError, type Actor } from "@/lib/inventory";
import { requirePermission } from "@/lib/session";
import { facilityToday } from "@/lib/time";

/** The one-screen Grow guide: each step saves, then says what happened and what comes next. Nothing here redirects. */

async function actor(): Promise<{ actor: Actor; facilityId: string }> {
  const session = await requirePermission("cultivation.write");
  return { actor: { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }, facilityId: session.facilityId };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const refresh = () => {
  revalidatePath("/cultivation", "layout");
};

export async function growBatchAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor: a, facilityId } = await actor();
    const strainId = field(formData, "strainId");
    let name = field(formData, "name");
    if (!name) {
      // No name given: strain and today's date, which is what people would type anyway.
      const [strain] = await db.select({ name: strains.name }).from(strains).where(and(eq(strains.id, strainId), eq(strains.orgId, a.orgId)));
      if (!strain) throw new InventoryError("Pick a strain from the list.");
      name = `${strain.name} ${await facilityToday(facilityId)}`;
    }
    await createPlantBatch(a, { name, strainId, source: field(formData, "source"), count: field(formData, "count"), locationId: field(formData, "locationId") });
    refresh();
    return { ok: `Batch ${name} started with ${plural(Number(field(formData, "count")) || 0, "plant")}. Next: tag the plants.` };
  } catch (error) {
    return toFormError(error);
  }
}

/** Change the stage of the chosen plants, move them to another room, or both. */
export async function growMoveAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor: a } = await actor();
    const plantIds = formData.getAll("plantId").map(String);
    if (!plantIds.length) throw new InventoryError("Check the plants first.");
    const stage = field(formData, "stage");
    const locationId = field(formData, "locationId");
    if (!stage && !locationId) throw new InventoryError("Choose a new stage, a new room, or both.");
    const parts: string[] = [];
    if (stage) parts.push(`${plural(await changePlantPhase(a, { plantIds, phase: stage }), "plant")} now ${stage.toLowerCase()}`);
    if (locationId) parts.push(`${plural(await movePlants(a, { plantIds, locationId }), "plant")} moved`);
    refresh();
    return { ok: `${parts.join(", ")}. Next: harvest when the flower days are up.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function growHarvestAction(_state: FormState, formData: FormData): Promise<FormState> {
  try {
    const { actor: a, facilityId } = await actor();
    const plantIds = formData.getAll("plantId").map(String);
    if (!plantIds.length) throw new InventoryError("Check the plants you are harvesting.");
    const name = field(formData, "harvestName") || `Harvest ${await facilityToday(facilityId)}`;
    const harvest = await harvestPlants(a, { plantIds, name, wetWeight: field(formData, "wetWeight"), unit: field(formData, "wetUnit") || "G", locationId: field(formData, "dryLocationId") });
    refresh();
    return { ok: `${harvest.name} recorded from ${plural(plantIds.length, "plant")}. Next: let it dry, then enter the dry weight.` };
  } catch (error) {
    return toFormError(error);
  }
}
