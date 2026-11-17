import { NextResponse } from "next/server";
import { InventoryError } from "@/lib/inventory-math";
import { currentSession } from "@/lib/session";
import { prepareFix } from "@/lib/watch/fix";

/** Prepare the plan card for a Tally Watch fix. Confirming it goes through /api/assistant/confirm. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { findingId } = (await request.json()) as { findingId?: string };
    return NextResponse.json(await prepareFix(session, String(findingId ?? "")));
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("watch fix failed", error);
    return NextResponse.json({ error: "Tally couldn't prepare that fix. Nothing was changed." }, { status: 500 });
  }
}
