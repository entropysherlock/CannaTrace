import { NextResponse } from "next/server";
import { buildOfflineSnapshot } from "@/lib/offline-snapshot";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

/** A copy of what this register needs to sell for cash with no internet. The register saves it on the device while online. */
export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(session, "pos.use")) return NextResponse.json({ error: "Your role does not use the register." }, { status: 403 });
  const snapshot = await buildOfflineSnapshot({ userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId });
  return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
}
