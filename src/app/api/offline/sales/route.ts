import { NextResponse } from "next/server";
import { InventoryError } from "@/lib/inventory-math";
import { recordOfflineSale } from "@/lib/offline-sales";
import type { OfflineSale } from "@/lib/offline-types";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

/** Send one cash sale that was rung up with no internet. Sending the same sale again returns the first result. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Please sign in again, then sync." }, { status: 401 });
  if (!can(session, "pos.use")) return NextResponse.json({ error: "Your role does not use the register." }, { status: 403 });
  if (session.isDemo) return NextResponse.json({ error: "Offline sales cannot be synced in the live demo." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That was not readable.", permanent: true }, { status: 400 });
  }
  try {
    const result = await recordOfflineSale({ userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId }, body as OfflineSale);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong on our side. The sale is still saved on this device." }, { status: 500 });
  }
}
