import { NextResponse } from "next/server";
import { labelRoute } from "@/lib/labels/http";
import { importLabel } from "@/lib/labels/import";
import { LabelError } from "@/lib/labels/service";
import { LABEL_KINDS, type LabelKind } from "@/lib/labels/types";

export const maxDuration = 120;

/** Rebuild an uploaded label photo, scan or PDF as a design. Saves nothing. */
export async function POST(req: Request) {
  return labelRoute("labels.manage", async (session) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new LabelError("The upload didn't arrive. Try again.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new LabelError("Choose a photo or PDF of a label.");
    if (file.size > 15 * 1024 * 1024) throw new LabelError("That file is over 15 MB. Use a smaller photo or PDF.");
    const kindRaw = String(form.get("kind") ?? "");
    const kind = LABEL_KINDS.some((k) => k.kind === kindRaw) ? (kindRaw as LabelKind) : null;
    const pickRaw = Number(form.get("pick"));
    const pick = form.get("pick") !== null && Number.isInteger(pickRaw) ? pickRaw : null;
    const result = await importLabel(session, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name }, { kind, pick });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
