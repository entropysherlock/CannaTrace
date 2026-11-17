import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { undoChange } from "@/lib/assistant/changes";
import { undoPermissions } from "@/lib/assistant/tools";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";
import { tallyChanges } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/** One-click Undo for a change Tally made. Same permissions as making it; all or nothing. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { changeId } = (await request.json()) as { changeId?: string };
    const [change] = await db
      .select({ tool: tallyChanges.tool })
      .from(tallyChanges)
      .where(and(eq(tallyChanges.id, String(changeId ?? "")), eq(tallyChanges.orgId, session.orgId), eq(tallyChanges.facilityId, session.facilityId)));
    if (!change) throw new InventoryError("That Tally change was not found at this facility.");
    if (!undoPermissions(change.tool).every((p) => can(session, p))) throw new InventoryError("Undoing this needs the same permission as making it, and your role doesn't have it.");
    const message = await undoChange(
      { userId: session.userId, userName: `${session.name} (undo via assistant)`, orgId: session.orgId, facilityId: session.facilityId },
      String(changeId),
    );
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: message });
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("assistant undo failed", error);
    return NextResponse.json({ error: "The undo did not go through. Nothing was changed." }, { status: 500 });
  }
}
