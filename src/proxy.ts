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
  if (pathname.startsWith("/api/sync/") || pathname === "/api/watch/run" || pathname === "/api/brief/run" || pathname === "/api/quickbooks/run" || pathname === "/api/loyalty/run" || pathname === "/api/sms/inbound") return NextResponse.next();
  // Uptime monitors can't sign in; the health check reveals nothing but "up" or "down".
  if (pathname === "/api/health") return NextResponse.next();
  // The offline register's service worker must load whatever the sign-in state.
  if (pathname === "/sw.js") return NextResponse.next();
  // A phone linking itself, or signing back in, has no sign-in yet. The capture page decides what to show.
  if (pathname.startsWith("/link/") || pathname === "/api/device/resume") return NextResponse.next();
  if (pathname === "/capture") {
    if (await isSignedIn(request)) return NextResponse.next();
    // Decided here, before any page is sent: a redirect from inside a streaming page would not reach the browser as one.
    return NextResponse.redirect(new URL(request.cookies.get("ct_device") ? "/api/device/resume" : "/login", request.url));
  }
  // A store's public menu and pickup reservations are for anyone, signed in or not.
  if (pathname.startsWith("/menu/")) return NextResponse.next();
  // A shopper's own rewards card (an unguessable link they were sent) opens without signing in.
  if (pathname.startsWith("/card/")) return NextResponse.next();
  // The REST API and the AI connector authenticate with API keys (or the OAuth sign-in that makes one), not a sign-in cookie.
  if (pathname.startsWith("/api/v1/") || pathname === "/api/mcp") return NextResponse.next();
  // AI apps find the sign-in details here and register and swap codes for keys without a cookie.
  if (pathname.startsWith("/.well-known/oauth-") || pathname.startsWith("/api/oauth/")) return NextResponse.next();
  // Connecting an AI app needs a signed-in person. Remember where they were headed so sign-in can bring them back.
  if (pathname === "/oauth/authorize" && !(await isSignedIn(request))) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("ct_after_login", `${pathname}${request.nextUrl.search}`.slice(0, 1500), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 900 });
    return response;
  }
  if (pathname === "/oauth/authorize" || pathname.startsWith("/oauth/authorize/")) return NextResponse.next();
  // Clearing a stale sign-in must work whether or not the cookie looks valid.
  if (pathname === "/signout") return NextResponse.next();
  // Invite links must open even for someone already signed in on this browser (an owner testing one, say).
  if (pathname.startsWith("/invite/")) return NextResponse.next();
  // Same for password reset links and the page explaining how to get one.
  if (pathname === "/reset" || pathname.startsWith("/reset/")) return NextResponse.next();
  // The live demo signs visitors in itself, and must also work for someone already in the demo.
  if (pathname === "/demo") return NextResponse.next();
  // Search engines read these without signing in.
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname.startsWith("/opengraph-image") || pathname === "/new-mexico-cannabis-seed-to-sale-software") return NextResponse.next();
  // Pricing is for everyone, signed in or not: the sales sheet's QR code lands here.
  if (pathname === "/pricing") return NextResponse.next();
  // The legal pages are public too, and must open for someone signed in (a link from inside the register, say).
  if (pathname === "/terms" || pathname === "/privacy" || pathname === "/data-agreement") return NextResponse.next();
  // Right after signing in, finish the connection that sent them to sign in.
  const after = request.cookies.get("ct_after_login")?.value;
  if (pathname === "/dashboard" && after?.startsWith("/oauth/authorize?") && (await isSignedIn(request))) {
    const response = NextResponse.redirect(new URL(after, request.url));
    response.cookies.delete("ct_after_login");
    return response;
  }
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
