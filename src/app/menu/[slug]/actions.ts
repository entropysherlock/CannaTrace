"use server";

import { unstable_rethrow } from "next/navigation";
import { InventoryError } from "@/lib/inventory-math";
import { createReservation } from "@/lib/online-menu";

export type ReserveResult = { id?: string; number?: string; error?: string };

/** Open to the public: a visitor reserves items for pickup. Every limit and check lives in createReservation. */
export async function reserveAction(
  slug: string,
  input: { name: string; phone: string; note: string; adult: boolean; website: string; lines: { itemId: string; quantity: string }[] },
): Promise<ReserveResult> {
  try {
    return await createReservation(slug, input);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof InventoryError) return { error: error.message };
    return { error: "Something went wrong. Please try again, or call the store." };
  }
}
