import { currentSession } from "@/lib/session";
import { findWalkthroughPage } from "@/lib/walkthrough-find";
import { FIND_KINDS, type FindKind } from "@/lib/walkthroughs";

/** Where a walkthrough step on a particular record should go: GET ?kind=order&status=CONFIRMED,PACKED → { url }. */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ url: null }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") as FindKind;
  if (!FIND_KINDS.includes(kind)) return Response.json({ url: null }, { status: 400 });
  const statuses = (params.get("status") ?? "").split(",").filter((s) => /^[A-Z_]+$/.test(s));
  const url = await findWalkthroughPage({ orgId: session.orgId, facilityId: session.facilityId }, kind, statuses);
  return Response.json({ url }, { headers: { "cache-control": "no-store" } });
}
