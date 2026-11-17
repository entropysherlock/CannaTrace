import { NextResponse } from "next/server";
import { actorOf, jsonBody, labelRoute } from "@/lib/labels/http";
import { LabelError, markJob } from "@/lib/labels/service";

/** A person reports what happened at the printer. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return labelRoute("labels.print", async (session) => {
    const body = await jsonBody(req);
    const status = body.status;
    if (status !== "PRINTED" && status !== "FAILED" && status !== "CANCELLED") throw new LabelError("Unknown status.");
    await markJob(actorOf(session), id, status, typeof body.note === "string" ? body.note : undefined);
    return NextResponse.json({ ok: true });
  });
}
