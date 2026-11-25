import "server-only";
import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { auditLogs, tallyAttachments, type TallyAttachment } from "@/db/schema";
import { encryptionReady, openBytes } from "@/lib/ai/secret-box";
import { db } from "@/lib/db";
import type { Session } from "@/lib/session";
import { AttachmentError, checkBeforeUpload, MAX_FILE_BYTES, type Kind } from "./limits";

/**
 * Storage for Tally attachments: private to the uploader at one facility, encrypted at rest,
 * and deleted when they expire. Files arrive in chunks because the hosting platform caps a single
 * request at about 4.5 MB.
 */

export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_PER_MESSAGE = 5;
/** Files one person may attach in 24 hours: TALLY_UPLOADS_PER_DAY, default 100. */
export const uploadsPerDay = () => Math.max(1, Number(process.env.TALLY_UPLOADS_PER_DAY ?? 100) || 100);
/** How long a file is kept: TALLY_FILE_RETENTION_HOURS, 1 to 720, default 24. */
export function retentionHours(): number {
  const n = Number(process.env.TALLY_FILE_RETENTION_HOURS ?? 24);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 720) : 24;
}

export type AttachmentInfo = { id: string; name: string; kind: Kind; size: number; meta: Record<string, unknown> };
export const ctx = (a: { orgId: string; id: string }) => `${a.orgId}:${a.id}`;
const cleanName = (name: string) => name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 150) || "file";

export async function log(session: Session, id: string, action: string, after: Record<string, unknown>) {
  // Size, type, and counts only: never the file's contents.
  await db.insert(auditLogs).values({ orgId: session.orgId, facilityId: session.facilityId, userId: session.userId, userName: session.name, entityType: "TallyFile", entityId: id, action, after });
}

/** Delete every expired file, and uploads abandoned for over an hour. */
export async function deleteExpiredAttachments(): Promise<number> {
  const gone = await db
    .delete(tallyAttachments)
    .where(or(lt(tallyAttachments.expiresAt, new Date()), and(eq(tallyAttachments.status, "UPLOADING"), lt(tallyAttachments.createdAt, new Date(Date.now() - 3_600_000)))))
    .returning({ id: tallyAttachments.id });
  return gone.length;
}

export async function startUpload(session: Session, input: { name: string; size: number; source?: "chat" | "phone" | "desktop" }): Promise<{ id: string; chunkBytes: number }> {
  // Documents sent to be read (from a phone or dropped on the desktop) wait for review much longer than chat files.
  const source = input.source === "phone" ? "phone" : input.source === "desktop" ? "desktop" : "chat";
  if (!encryptionReady()) throw new AttachmentError("File attachments aren't set up on this server yet (secure storage is missing). Leaf2Sale support needs to finish setup.");
  const name = cleanName(String(input.name ?? ""));
  const size = Math.trunc(Number(input.size));
  if (!Number.isFinite(size) || size > MAX_FILE_BYTES) throw new AttachmentError(`${name} is too large to attach.`);
  checkBeforeUpload(name, size);
  await deleteExpiredAttachments();
  // The allowance counts uploads STARTED (kept in the audit log), not files still stored, so deleting a file
  // does not hand the allowance back. The per-person lock stops two simultaneous uploads both slipping under it.
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`upload:${session.orgId}:${session.userId}`}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, session.orgId), eq(auditLogs.userId, session.userId), eq(auditLogs.entityType, "TallyFile"), eq(auditLogs.action, "UPLOAD_START"), gt(auditLogs.createdAt, new Date(Date.now() - 86_400_000))));
    if (n >= uploadsPerDay()) throw new AttachmentError(`You've attached ${uploadsPerDay()} files in the last 24 hours, the most allowed. Try again later.`);
    const [made] = await tx
      .insert(tallyAttachments)
      .values({
        orgId: session.orgId,
        facilityId: session.facilityId,
        userId: session.userId,
        name,
        kind: "PENDING",
        size,
        staging: Buffer.alloc(0),
        source,
        // Photos from a phone wait in the inbox for a week; a file attached to a Tally question goes after a day.
        expiresAt: new Date(Date.now() + (source !== "chat" ? Math.max(retentionHours(), 168) : retentionHours()) * 3_600_000),
      })
      .returning({ id: tallyAttachments.id });
    await tx.insert(auditLogs).values({ orgId: session.orgId, facilityId: session.facilityId, userId: session.userId, userName: session.name, entityType: "TallyFile", entityId: made.id, action: "UPLOAD_START", after: { sizeBytes: size, source } });
    return made;
  });
  return { id: row.id, chunkBytes: CHUNK_BYTES };
}

/** The person's own file at their current facility, or nothing: other people's files are never found. */
export async function own(session: Session, id: string) {
  const [row] = await db
    .select()
    .from(tallyAttachments)
    .where(
      and(
        eq(tallyAttachments.id, String(id)),
        eq(tallyAttachments.orgId, session.orgId),
        eq(tallyAttachments.facilityId, session.facilityId),
        eq(tallyAttachments.userId, session.userId),
        gt(tallyAttachments.expiresAt, new Date()),
      ),
    );
  if (!row) throw new AttachmentError("That file isn't available. It may have expired; attach it again.");
  return row;
}

export async function appendChunk(session: Session, id: string, offset: number, chunk: Buffer): Promise<{ received: number }> {
  if (chunk.length === 0 || chunk.length > CHUNK_BYTES) throw new AttachmentError("That part of the upload was the wrong size. Try attaching the file again.");
  const row = await own(session, id);
  if (row.status !== "UPLOADING") throw new AttachmentError("This file has already been uploaded.");
  if (offset !== row.received) throw new AttachmentError("Part of the upload arrived out of order. Try attaching the file again.");
  if (row.received + chunk.length > row.size) throw new AttachmentError("The file is bigger than it said it was. Try attaching it again.");
  const [updated] = await db
    .update(tallyAttachments)
    .set({ staging: sql`coalesce(${tallyAttachments.staging}, ''::bytea) || ${chunk}`, received: sql`${tallyAttachments.received} + ${chunk.length}` })
    .where(and(eq(tallyAttachments.id, row.id), eq(tallyAttachments.received, offset)))
    .returning({ received: tallyAttachments.received });
  if (!updated) throw new AttachmentError("Part of the upload arrived out of order. Try attaching the file again.");
  return { received: updated.received };
}

export function info(row: TallyAttachment): AttachmentInfo {
  return { id: row.id, name: row.name, kind: row.kind as Kind, size: row.size, meta: row.meta ?? {} };
}

export async function deleteAttachment(session: Session, id: string): Promise<void> {
  const row = await own(session, id);
  await db.delete(tallyAttachments).where(eq(tallyAttachments.id, row.id));
  if (row.status === "READY") await log(session, row.id, "DELETE", { kind: row.kind });
}

export type LoadedAttachment = AttachmentInfo & { payload: Buffer };

/** Ready files by id that belong to this person here and haven't expired. Unknown ids are skipped. */
export async function loadAttachments(session: Session, ids: string[]): Promise<LoadedAttachment[]> {
  const wanted = [...new Set(ids.filter((x) => typeof x === "string" && x.length <= 64))].slice(0, 50);
  if (!wanted.length) return [];
  const rows = await db
    .select()
    .from(tallyAttachments)
    .where(
      and(
        inArray(tallyAttachments.id, wanted),
        eq(tallyAttachments.orgId, session.orgId),
        eq(tallyAttachments.facilityId, session.facilityId),
        eq(tallyAttachments.userId, session.userId),
        eq(tallyAttachments.status, "READY"),
        gt(tallyAttachments.expiresAt, new Date()),
      ),
    );
  return rows.map((r) => ({ ...info(r), payload: openBytes(Buffer.from(r.payload!), ctx(r)) }));
}

export async function loadAttachment(session: Session, id: string): Promise<LoadedAttachment> {
  const [found] = await loadAttachments(session, [id]);
  if (!found) throw new AttachmentError("That attached file isn't available. It may have expired; ask the person to attach it again.");
  return found;
}
