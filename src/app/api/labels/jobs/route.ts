import { NextResponse } from "next/server";
import { actorOf, jsonBody, labelRoute, strList } from "@/lib/labels/http";
import { createPrintJob } from "@/lib/labels/service";

/** Create a print job. Sending the same idempotency key again returns the first job instead of a new one. */
export async function POST(req: Request) {
  return labelRoute("labels.print", async (session) => {
    const body = await jsonBody(req);
    const { job, duplicate } = await createPrintJob(actorOf(session), {
      templateId: String(body.templateId ?? ""),
      sourceIds: strList(body.sourceIds),
      copies: Number(body.copies ?? 1),
      idempotencyKey: String(body.idempotencyKey ?? ""),
      printerId: typeof body.printerId === "string" && body.printerId ? body.printerId : null,
    });
    return NextResponse.json({ job: { id: job.id, status: job.status, labelCount: job.labelCount }, duplicate });
  });
}
