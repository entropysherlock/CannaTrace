import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = ["/", "/login", "/setup", "/signup"];

async function isSignedIn(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get("ct_session")?.value;
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // A broken link (a cut-off %-escape, say) can't be read as a page address: show "not found", not a server error.
  try {
    decodeURIComponent(pathname);
  } catch {
    return new NextResponse("That link is broken or incomplete. Go back and try again, or start from the dashboard.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // Scheduled sync runs authenticate with their own secret, not a sign-in cookie.
  if (pathname.startsWith("/api/sync/") || pathname === "/api/watch/run") return NextResponse.next();
  // The REST API authenticates with API keys, not a sign-in cookie.
  if (pathname.startsWith("/api/v1/")) return NextResponse.next();
  // Clearing a stale sign-in must work whether or not the cookie looks valid.
  if (pathname === "/signout") return NextResponse.next();
  // Invite links must open even for someone already signed in on this browser (an owner testing one, say).
  if (pathname.startsWith("/invite/")) return NextResponse.next();
  // Same for password reset links and the page explaining how to get one.
  if (pathname === "/reset" || pathname.startsWith("/reset/")) return NextResponse.next();
  // The live demo signs visitors in itself, and must also work for someone already in the demo.
  if (pathname === "/demo") return NextResponse.next();
  // Pricing is for everyone, signed in or not: the sales sheet's QR code lands here.
  if (pathname === "/pricing") return NextResponse.next();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const signedIn = await isSignedIn(request);
  if (!signedIn && !isPublic) return NextResponse.redirect(new URL("/login", request.url));
  // The homepage is open to everyone; sign-in and sign-up pages send signed-in people to their dashboard.
  if (signedIn && isPublic && pathname !== "/") return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4)$).*)"],
};
