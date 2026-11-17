import { actorOf, labelRoute } from "@/lib/labels/http";
import { renderJob } from "@/lib/labels/service";

/** The job's labels as an exact-size PDF. Each request is a counted attempt. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return labelRoute("labels.print", async (session) => {
    const { pdf, fileName } = await renderJob(actorOf(session), id);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
