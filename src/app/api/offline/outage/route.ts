import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/inventory";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

/** Record a stretch when the register had no internet. Required records if the store lost access to the state system (APEX-23b). */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(session, "pos.use")) return NextResponse.json({ error: "Your role does not use the register." }, { status: 403 });
  if (session.isDemo) return NextResponse.json({ ok: true });
  const body = (await request.json().catch(() => null)) as { startedAt?: unknown; endedAt?: unknown; sales?: unknown } | null;
  const start = new Date(String(body?.startedAt ?? ""));
  const end = new Date(String(body?.endedAt ?? ""));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return NextResponse.json({ error: "That outage was not readable.", permanent: true }, { status: 400 });
  const sales = Math.max(0, Math.min(10_000, Math.floor(Number(body?.sales) || 0)));
  const actor = { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
  await db.transaction((tx) =>
    audit(tx, actor, {
      entityType: "Facility",
      entityId: session.facilityId,
      action: "REGISTER_OFFLINE",
      after: { startedAt: start.toISOString(), endedAt: end.toISOString(), salesWhileOffline: sales },
      reason: "The register had no internet. If the store also lost access to the state track-and-trace system, tell the Cannabis Control Division and keep records of what happened.",
    }),
  );
  return NextResponse.json({ ok: true });
}
