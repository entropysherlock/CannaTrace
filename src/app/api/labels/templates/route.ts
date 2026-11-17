import { NextResponse } from "next/server";
import { actorOf, jsonBody, labelRoute } from "@/lib/labels/http";
import { createTemplate, LabelError } from "@/lib/labels/service";
import { LABEL_KINDS, type LabelKind } from "@/lib/labels/types";

export async function POST(req: Request) {
  return labelRoute("labels.manage", async (session) => {
    const body = await jsonBody(req);
    const kind = String(body.kind ?? "") as LabelKind;
    if (!LABEL_KINDS.some((k) => k.kind === kind)) throw new LabelError("Choose a label type.");
    const id = await createTemplate(actorOf(session), {
      name: String(body.name ?? ""),
      kind,
      jurisdiction: typeof body.jurisdiction === "string" && body.jurisdiction ? body.jurisdiction : null,
      design: body.design,
      copyOf: typeof body.copyOf === "string" ? body.copyOf : null,
    });
    return NextResponse.json({ id });
  });
}
