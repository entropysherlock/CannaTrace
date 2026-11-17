import { NextResponse } from "next/server";
import { InventoryError } from "@/lib/inventory-math";
import { liveDemoEnabled, liveDemoSession } from "@/lib/demo/live-demo";
import { createSession, currentSession } from "@/lib/session";

export const maxDuration = 60;

/** One click into the shared live demo: sign the visitor in to today's sample business. */
async function enterDemo(request: Request) {
  const home = (hash: string) => NextResponse.redirect(new URL(`/${hash}`, request.url), 303);
  if (!liveDemoEnabled()) return home("?demo=off#demo");
  const existing = await currentSession();
  // Someone signed in to their real business keeps that sign-in; the demo never replaces it.
  if (existing && !existing.isDemo) return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  try {
    await createSession(await liveDemoSession());
  } catch (error) {
    console.error("live demo failed", error);
    return home(error instanceof InventoryError ? "?demo=busy#demo" : "?demo=error#demo");
  }
  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}

export const GET = enterDemo;
export const POST = enterDemo;
