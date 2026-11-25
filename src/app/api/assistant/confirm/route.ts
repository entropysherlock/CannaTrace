import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { confirmProposal } from "@/lib/assistant/engine";
import { InventoryError } from "@/lib/inventory-math";
import { currentSession } from "@/lib/session";
import { inFacilityZone } from "@/lib/time";
import { refreshWatch } from "@/lib/watch";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { token } = (await request.json()) as { token?: string };
    const outcome = await inFacilityZone(session.facilityId, () => confirmProposal(session, String(token ?? "")));
    // Let Tally Watch see the change before the page refreshes, so a finding this fixed is gone at once.
    // The change is already saved. If Watch can't refresh, say nothing went wrong rather than "nothing was changed".
    await refreshWatch(session).catch((error) => console.error("watch refresh after confirm failed", (error as Error)?.name));
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: outcome.message, changeId: outcome.undoable ? outcome.changeId : null });
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("assistant confirm failed", (error as Error)?.name);
    return NextResponse.json({ error: "That did not go through. Nothing was changed." }, { status: 500 });
  }
}
