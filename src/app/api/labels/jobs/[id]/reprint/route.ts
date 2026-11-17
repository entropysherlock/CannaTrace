import { NextResponse } from "next/server";
import { actorOf, jsonBody, labelRoute } from "@/lib/labels/http";
import { reprintJob } from "@/lib/labels/service";

/** Print the same labels again as a new job. Inventory is never touched. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return labelRoute("labels.print", async (session) => {
    const body = await jsonBody(req);
    const { job, duplicate } = await reprintJob(actorOf(session), id, String(body.idempotencyKey ?? ""), body.copies ? Number(body.copies) : undefined);
    return NextResponse.json({ job: { id: job.id, status: job.status, labelCount: job.labelCount }, duplicate });
  });
}
