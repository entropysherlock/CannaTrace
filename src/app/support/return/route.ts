import { NextResponse } from "next/server";
import { endSupportVisit } from "@/lib/platform-admin";
import { createSession, getSession } from "@/lib/session";

/** Leave a customer's account (or come back after a visit ran out) and return to the support console. */
async function leave(request: Request) {
  const token = await getSession();
  if (!token?.support) return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  const home = await endSupportVisit({ ...token, support: token.support }, token.name.replace(/ \(CannaTrace support\)$/, ""));
  await createSession(home);
  return NextResponse.redirect(new URL("/support", request.url), 303);
}

export const GET = leave;
export const POST = leave;
