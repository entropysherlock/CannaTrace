import { NextResponse } from "next/server";
import { authorizeUrl, newState, quickbooksConfigured } from "@/lib/quickbooks";
import { requirePermission } from "@/lib/session";

/** Start the one-click connect: send the signed-in manager to Intuit, remembering a one-time state in a cookie. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  try {
    await requirePermission("settings.manage");
  } catch {
    return NextResponse.redirect(new URL("/settings/quickbooks?problem=permission", origin), 303);
  }
  if (!quickbooksConfigured()) return NextResponse.redirect(new URL("/settings/quickbooks?problem=setup", origin), 303);
  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(origin, state), 303);
  res.cookies.set("qb_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/quickbooks", maxAge: 600 });
  return res;
}
