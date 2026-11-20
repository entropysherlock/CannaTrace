import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { DEVICE_COOKIE, deviceSession } from "@/lib/devices";
import { createSession } from "@/lib/session";

/** A linked phone whose sign-in ran out signs itself back in here, with no password. */
export async function GET(request: NextRequest) {
  const found = await deviceSession(request.cookies.get(DEVICE_COOKIE)?.value);
  if (!found) {
    (await cookies()).delete(DEVICE_COOKIE);
    redirect("/login");
  }
  await createSession(found.user);
  redirect("/capture");
}
