import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { tallyAttachments } from "@/db/schema";
import { sealBytes } from "@/lib/ai/secret-box";
import { db } from "@/lib/db";
import type { Session } from "@/lib/session";
import { AttachmentError } from "./limits";
import { processFile } from "./process";
import { ctx, info, log, own, type AttachmentInfo } from "./store";

/** Checking and reading an uploaded file. The only place the file-reading libraries are loaded. */

export async function finishUpload(session: Session, id: string): Promise<AttachmentInfo> {
  const row = await own(session, id);
  if (row.status === "READY") return info(row);
  if (row.received !== row.size || !row.staging) throw new AttachmentError("The upload didn't finish. Try attaching the file again.");
  const bytes = Buffer.from(row.staging);
  try {
    const processed = await processFile(bytes, row.name);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const [ready] = await db
      .update(tallyAttachments)
      .set({ status: "READY", kind: processed.kind, staging: null, payload: sealBytes(processed.payload, ctx(row)), meta: processed.meta, sha256 })
      .where(eq(tallyAttachments.id, row.id))
      .returning();
    await log(session, row.id, "UPLOAD", { kind: processed.kind, sizeBytes: row.size, sha256: sha256.slice(0, 16), ...counts(processed.meta) });
    return info(ready);
  } catch (error) {
    // A file that fails checks is not kept.
    await db.delete(tallyAttachments).where(eq(tallyAttachments.id, row.id));
    if (error instanceof AttachmentError) throw error;
    console.error("attachment processing failed", (error as Error)?.name);
    throw new AttachmentError(`${row.name} couldn't be read.`);
  }
}

function counts(meta: Record<string, unknown>) {
  const m = meta as { pages?: number; sheets?: { totalRows: number }[]; chars?: number; width?: number; height?: number };
  return { pages: m.pages, sheets: m.sheets?.length, rows: m.sheets?.reduce((t, s) => t + s.totalRows, 0), chars: m.chars, pixels: m.width ? `${m.width}x${m.height}` : undefined };
}

