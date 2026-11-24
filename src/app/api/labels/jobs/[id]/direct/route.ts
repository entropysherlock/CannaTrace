import { NextResponse } from "next/server";
import { actorOf, labelRoute } from "@/lib/labels/http";
import { directJob } from "@/lib/labels/service";

/**
 * A job's labels as drawings, for sending straight to a Zebra from the browser. Answers {direct: false}
 * when the job's printer isn't a Zebra, so the caller falls back to the PDF. Counts as a print attempt.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return labelRoute("labels.print", async (session) => {
    return NextResponse.json(await directJob(actorOf(session), id), { headers: { "Cache-Control": "no-store" } });
  });
}
