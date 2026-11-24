import { NextResponse } from "next/server";
import { parseDesign } from "@/lib/labels/design";
import { sampleValues } from "@/lib/labels/fields";
import { actorOf, jsonBody, labelRoute } from "@/lib/labels/http";
import { renderLabelsPdf } from "@/lib/labels/render-pdf";
import { LabelError } from "@/lib/labels/service";
import { LABEL_KINDS, type LabelKind } from "@/lib/labels/types";

/**
 * A sample of a design exactly as it is on screen (saved or not), with example data, as a PDF to check on label stock.
 * It is not a print job and uses no real record, so it is not for labelling product.
 */
export async function POST(req: Request) {
  return labelRoute("labels.print", async (session) => {
    void actorOf(session);
    const body = await jsonBody(req);
    const kind = String(body.kind ?? "") as LabelKind;
    if (!LABEL_KINDS.some((k) => k.kind === kind)) throw new LabelError("Choose a label type.");
    const design = parseDesign(body.design);
    const values: Record<string, string | null> = { ...sampleValues(kind) };
    if (body.values && typeof body.values === "object") {
      for (const [k, v] of Object.entries(body.values as Record<string, unknown>).slice(0, 200)) if (typeof v === "string") values[k] = v.slice(0, 500);
    }
    const copies = Math.min(10, Math.max(1, Math.trunc(Number(body.copies ?? 1)) || 1));
    const pdf = await renderLabelsPdf(design, [{ ref: "sample", sourceId: "sample", values }], { copies, title: "Label sample" });
    return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  });
}
