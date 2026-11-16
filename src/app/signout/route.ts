import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Throws away the sign-in cookie and goes to the sign-in page. Used when a cookie is still
 * valid but its account no longer exists or was deactivated; without this the sign-in page
 * (which sends signed-in visitors to the dashboard) and the dashboard (which sends unknown
 * accounts to sign in) would bounce the visitor between each other forever.
 */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
