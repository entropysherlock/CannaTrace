"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import {
  addScannedCode,
  addToCart,
  attachRewardsMember,
  cancelCart,
  checkInCustomer,
  completeSale,
  detachRewardsMember,
  joinRewards,
  linkIdToRewardsMember,
  openDrawer,
  setCartDiscount,
  setLineQuantity,
  setRewardsUsed,
} from "@/lib/pos";
import { requirePermission } from "@/lib/session";

/** What every register button gets back: a message to show, and sometimes where to go next. */
export type TerminalResult = { ok?: string; error?: string; saleId?: string; notFound?: boolean };

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
    unstable_rethrow(error);
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

export async function terminalPay(input: { saleId: string; method: string; cashTendered: string; debitAmount: string; cardLast4?: string; cardRef?: string }): Promise<TerminalResult> {
  return run(async (actor) => {
    await completeSale(actor, { saleId: input.saleId, paymentMethod: input.method, cashTendered: input.cashTendered, debitAmount: input.debitAmount, cardLast4: input.cardLast4, cardRef: input.cardRef });
    revalidatePath("/inventory");
    return { saleId: input.saleId };
  });
}

/** Rewards: find the shopper by phone and put them on the cart. notFound means offer to sign them up. */
export async function terminalRewardsFind(saleId: string, phone: string): Promise<TerminalResult> {
  return run(async (actor) => {
    const found = await attachRewardsMember(actor, { saleId, phone });
    if (!found) return { notFound: true };
    return { ok: `${found.firstName} has ${found.points} points` };
  });
}

export async function terminalRewardsJoin(input: { saleId: string; phone: string; firstName: string; birthday: string; agreed: boolean }): Promise<TerminalResult> {
  return run(async (actor) => {
    const joined = await joinRewards(actor, input);
    return { ok: `${joined.firstName} joined rewards with ${joined.points} welcome points` };
  });
}

/** With the shopper's agreement, link this cart's ID scan to their rewards account. */
export async function terminalRewardsLinkId(saleId: string): Promise<TerminalResult> {
  return run(async (actor) => {
    await linkIdToRewardsMember(actor, { saleId });
    return { ok: "Linked. Next time their ID scan finds their rewards." };
  });
}

export async function terminalRewardsRemove(saleId: string): Promise<TerminalResult> {
  return run(async (actor) => {
    await detachRewardsMember(actor, { saleId });
  });
}

export async function terminalRewardsUse(saleId: string, count: number): Promise<TerminalResult> {
  return run(async (actor) => {
    await setRewardsUsed(actor, { saleId, count });
  });
}
