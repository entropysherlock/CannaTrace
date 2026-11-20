import { NextResponse } from "next/server";
import { attachmentRoute } from "@/lib/assistant/attachments/http";
import { startUpload } from "@/lib/assistant/attachments/store";

/** Start an upload: the name and size are checked before any bytes are sent. */
export async function POST(request: Request) {
  return attachmentRoute(async (session) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string; size?: number; source?: string };
    return NextResponse.json(await startUpload(session, { name: String(body.name ?? ""), size: Number(body.size), source: body.source === "phone" ? "phone" : body.source === "desktop" ? "desktop" : "chat" }));
  });
}
