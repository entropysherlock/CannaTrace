import "server-only";
import { NextResponse } from "next/server";
import { resolveTally } from "@/lib/ai/connection";
import { InventoryError } from "@/lib/inventory-math";
import { currentSession, type Session } from "@/lib/session";
import { AttachmentError } from "./process";

/** Signed in, with Tally available to them: otherwise there's nothing to attach files to. */
export async function attachmentRoute(fn: (session: Session) => Promise<Response>): Promise<Response> {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const route = await resolveTally(session);
  if (route.kind === "off") return NextResponse.json({ error: "Tally isn't available for this business, so files can't be attached." }, { status: 503 });
  try {
    return await fn(session);
  } catch (error) {
    if (error instanceof AttachmentError || error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("attachment request failed", (error as Error)?.name);
    return NextResponse.json({ error: "The file couldn't be attached. Try again." }, { status: 500 });
  }
}
