import { NextResponse } from "next/server";
import { matchPackages } from "@/lib/scan/read";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

/** Packages at this store matching what was typed, for choosing which one a document is about. */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!can(session, "inventory.write")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 60);
  return NextResponse.json({ matches: q.trim().length < 2 ? [] : await matchPackages(session, { tag: "", lot: "", product: "", sampleId: "" }, q) });
}
