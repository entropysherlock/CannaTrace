import { NextResponse } from "next/server";
import { completeConnect } from "@/lib/quickbooks";
import { requirePermission } from "@/lib/session";

/** Where Intuit sends the person back. The state must match the cookie set when they left. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (problem?: string) => {
    const res = NextResponse.redirect(new URL(`/settings/quickbooks${problem ? `?problem=${problem}` : "?connected=1"}`, url.origin), 303);
    res.cookies.set("qb_state", "", { path: "/api/quickbooks", maxAge: 0 });
    return res;
  };
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)qb_state=([^;]+)/)?.[1];
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return back("declined");
  if (!cookie || !state || cookie !== state) return back("state");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  if (!code || !realmId) return back("missing");
  try {
    const session = await requirePermission("settings.manage");
    await completeConnect(session, { code, realmId, origin: url.origin });
    return back();
  } catch {
    return back("failed");
  }
}
