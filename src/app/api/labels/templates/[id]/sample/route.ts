import { actorOf, labelRoute } from "@/lib/labels/http";
import { sampleValues } from "@/lib/labels/fields";
import { renderLabelsPdf } from "@/lib/labels/render-pdf";
import { getTemplate } from "@/lib/labels/service";

/**
 * A sample of the saved template with example data, as a PDF, to check how it looks on real label stock.
 * It is not a print job: nothing is recorded and it never uses a real record, so it is not for labelling product.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const copies = Math.min(10, Math.max(1, Math.trunc(Number(new URL(req.url).searchParams.get("copies") ?? 1)) || 1));
  return labelRoute("labels.print", async (session) => {
    const { template, design } = await getTemplate(actorOf(session), id);
    const pdf = await renderLabelsPdf(design, [{ ref: "sample", sourceId: "sample", values: sampleValues(template.kind) }], { copies, title: `${template.name} (sample)` });
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="sample-label.pdf"', "Cache-Control": "no-store" } });
  });
}
