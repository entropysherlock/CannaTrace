import { NextResponse } from "next/server";
import { attachmentRoute } from "@/lib/assistant/attachments/http";
import { finishUpload } from "@/lib/assistant/attachments/finish";
import { AttachmentError } from "@/lib/assistant/attachments/limits";
import { appendChunk, CHUNK_BYTES, deleteAttachment } from "@/lib/assistant/attachments/store";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** One piece of the file, sent as raw bytes with ?offset=. */
export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  return attachmentRoute(async (session) => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > CHUNK_BYTES) throw new AttachmentError("That part of the upload is too large.");
    const chunk = Buffer.from(await request.arrayBuffer());
    const offset = Number(new URL(request.url).searchParams.get("offset"));
    return NextResponse.json(await appendChunk(session, id, Number.isInteger(offset) ? offset : -1, chunk));
  });
}

/** All pieces sent: check and read the file. */
export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return attachmentRoute(async (session) => NextResponse.json(await finishUpload(session, id)));
}

/** Remove a file before sending, or any time after. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return attachmentRoute(async (session) => {
    await deleteAttachment(session, id);
    return NextResponse.json({ ok: true });
  });
}
