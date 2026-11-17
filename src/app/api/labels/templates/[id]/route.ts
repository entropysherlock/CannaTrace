import { NextResponse } from "next/server";
import { actorOf, jsonBody, labelRoute } from "@/lib/labels/http";
import { saveTemplateVersion, setDefaultTemplate, setTemplateArchived, LabelError } from "@/lib/labels/service";

/** Save a new version of a template's design. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return labelRoute("labels.manage", async (session) => {
    const body = await jsonBody(req);
    const version = await saveTemplateVersion(actorOf(session), id, {
      design: body.design,
      note: typeof body.note === "string" ? body.note : undefined,
      baseVersion: Number(body.baseVersion),
      name: typeof body.name === "string" ? body.name : undefined,
      jurisdiction: body.jurisdiction === undefined ? undefined : typeof body.jurisdiction === "string" ? body.jurisdiction : null,
    });
    return NextResponse.json({ version });
  });
}

/** Make default, archive, or restore. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return labelRoute("labels.manage", async (session) => {
    const body = await jsonBody(req);
    const actor = actorOf(session);
    if (body.action === "default") await setDefaultTemplate(actor, id);
    else if (body.action === "archive") await setTemplateArchived(actor, id, true);
    else if (body.action === "restore") await setTemplateArchived(actor, id, false);
    else throw new LabelError("Unknown action.");
    return NextResponse.json({ ok: true });
  });
}
