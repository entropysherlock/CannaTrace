import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";

export default async function AuditPage() {
  const session = await requirePagePermission("audit.view");
  const entries = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.orgId, session.orgId),
        or(eq(auditLogs.facilityId, session.facilityId), isNull(auditLogs.facilityId)),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every change, who made it, and when. Entries cannot be edited or deleted." />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="px-4 py-3">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <span className="font-semibold text-slate-900">{entry.userName}</span>{" "}
                <span className="text-slate-600">{entry.action.toLowerCase()}</span>{" "}
                {entry.entityType === "Package" ? (
                  <Link href={`/inventory/${entry.entityId}`} className="font-medium text-brand-700 hover:underline">
                    package
                  </Link>
                ) : (
                  <span className="text-slate-600">{entry.entityType.toLowerCase()}</span>
                )}
              </span>
              <time className="text-slate-500">{entry.createdAt.toLocaleString("en-US")}</time>
            </div>
            {entry.reason ? <p className="text-slate-600">{entry.reason}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
