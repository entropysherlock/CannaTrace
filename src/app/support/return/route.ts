import { NextResponse } from "next/server";
import { endSupportVisit } from "@/lib/platform-admin";
import { createSession, destroySession, getSession } from "@/lib/session";

/** Leave a customer's account (or come back after a visit ran out) and return to the support console. */
async function leave(request: Request) {
  const token = await getSession();
  if (!token?.support) return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  let home;
  try {
    home = await endSupportVisit({ ...token, support: token.support }, token.name.replace(/ \(Leaf2Sale support\)$/, ""));
  } catch {
    // The visit's sign-in no longer counts (password changed, account switched off): sign out instead.
    await destroySession();
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }
  await createSession(home);
  return NextResponse.redirect(new URL("/support", request.url), 303);
}

export const GET = leave;
export const POST = leave;
