"use server";

import { revalidatePath } from "next/cache";
import type { Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import {
  addScannedCode,
  addToCart,
  cancelCart,
  checkInCustomer,
  completeSale,
  openDrawer,
  setCartDiscount,
  setLineQuantity,
} from "@/lib/pos";
import { requirePermission } from "@/lib/session";

/** What every register button gets back: a message to show, and sometimes where to go next. */
export type TerminalResult = { ok?: string; error?: string; saleId?: string };

async function clerk(): Promise<Actor> {
  const session = await requirePermission("pos.use");
  return { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
}

async function run(work: (actor: Actor) => Promise<TerminalResult | void>): Promise<TerminalResult> {
  try {
    const result = (await work(await clerk())) ?? {};
    revalidatePath("/pos", "layout");
    return result;
  } catch (error) {
    if (error instanceof InventoryError) return { error: error.message };
    if (error instanceof Error && error.name === "PermissionError") return { error: error.message };
    console.error("register action failed", error);
    return { error: "Something went wrong on our side. Nothing was changed. Try again." };
  }
}

export async function terminalOpenDrawer(openingCash: string): Promise<TerminalResult> {
  return run(async (actor) => {
    await openDrawer(actor, { openingCash });
    return { ok: "Drawer open. Ready for the first customer." };
  });
}

export async function terminalCheckIn(input: { birthDate: string; idExpires: string; customerType: string; idNumber?: string }): Promise<TerminalResult> {
  return run(async (actor) => ({ saleId: (await checkInCustomer(actor, input)).id }));
}

export async function terminalScan(saleId: string, code: string): Promise<TerminalResult> {
  return run(async (actor) => ({ ok: `Added ${(await addScannedCode(actor, { saleId, code })).itemName}` }));
}

export async function terminalAdd(saleId: string, itemId: string, quantity = "1"): Promise<TerminalResult> {
  return run(async (actor) => {
    await addToCart(actor, { saleId, itemId, quantity });
  });
}

export async function terminalSetQuantity(lineId: string, quantity: string): Promise<TerminalResult> {
  return run(async (actor) => {
    await setLineQuantity(actor, { lineId, quantity });
  });
}

export async function terminalDiscount(saleId: string, discountId: string): Promise<TerminalResult> {
  return run(async (actor) => {
    await setCartDiscount(actor, { saleId, discountId });
  });
}

export async function terminalCancel(saleId: string): Promise<TerminalResult> {
  return run(async (actor) => {
    await cancelCart(actor, { saleId });
    return { ok: "Cart cancelled. Nothing left inventory." };
  });
}

export async function terminalPay(input: { saleId: string; method: string; cashTendered: string; debitAmount: string }): Promise<TerminalResult> {
  return run(async (actor) => {
    await completeSale(actor, { saleId: input.saleId, paymentMethod: input.method, cashTendered: input.cashTendered, debitAmount: input.debitAmount });
    revalidatePath("/inventory");
    return { saleId: input.saleId };
  });
}
