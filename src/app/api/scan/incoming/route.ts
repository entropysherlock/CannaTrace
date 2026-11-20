import { and, desc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { scanReads, tallyAttachments } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

/**
 * The newest document this person's phone sent and Tally has finished reading since a moment the desktop gives.
 * The desktop asks every few seconds, so a photo taken on the phone can open its review screen on its own.
 * The first call (no "since") only returns the server's clock, so the two devices never need matching clocks.
 */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const now = new Date();
  if (!can(session, "inventory.write")) return NextResponse.json({ now: now.toISOString(), incoming: null });
  const since = new Date(String(new URL(request.url).searchParams.get("since") ?? ""));
  if (Number.isNaN(since.getTime())) return NextResponse.json({ now: now.toISOString(), incoming: null });
  const [row] = await db
    .select({ attachmentId: scanReads.attachmentId, kind: scanReads.kind })
    .from(scanReads)
    .innerJoin(tallyAttachments, eq(tallyAttachments.id, scanReads.attachmentId))
    .where(
      and(
        eq(scanReads.orgId, session.orgId),
        eq(scanReads.facilityId, session.facilityId),
        eq(scanReads.userId, session.userId),
        eq(scanReads.status, "READ"),
        eq(tallyAttachments.source, "phone"),
        gt(scanReads.createdAt, since),
      ),
    )
    .orderBy(desc(scanReads.createdAt))
    .limit(1);
  return NextResponse.json({ now: now.toISOString(), incoming: row ? { id: row.attachmentId, kind: row.kind } : null });
}
