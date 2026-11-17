import { and, eq } from "drizzle-orm";
import { labResults } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { currentSession } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session || !can(session, "inventory.view")) return new Response("Sign in to view this file.", { status: 401 });
  const { id } = await params;
  const [result] = await db
    .select({ name: labResults.coaFileName, type: labResults.coaMimeType, data: labResults.coaData })
    .from(labResults)
    .where(and(eq(labResults.id, id), eq(labResults.orgId, session.orgId), eq(labResults.facilityId, session.facilityId)));
  if (!result?.data) return new Response("File not found.", { status: 404 });

  const safeName = (result.name ?? "coa").replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(result.data), {
    headers: {
      "Content-Type": result.type ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
