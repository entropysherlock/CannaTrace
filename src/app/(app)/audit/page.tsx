import Link from "next/link";
import { TallyUndoButton } from "@/components/tally-undo-button";
import { PageHeader } from "@/components/ui";
import { recentChanges } from "@/lib/assistant/changes";
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
  const tally = await recentChanges(session, 15);

  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every change, who made it, and when. Entries cannot be edited or deleted." />
      {tally.length ? (
        <section className="mb-6" aria-labelledby="tally-changes">
          <h2 id="tally-changes" className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Changes made through Tally
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
            {tally.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="font-semibold text-slate-900">{c.title}</span>
                  <span className="block text-slate-600">{c.result}</span>
                  <span className="block text-xs text-slate-500">
                    {c.userName} · {c.createdAt.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
                {c.status === "UNDONE" ? (
                  <span className="text-xs font-medium text-slate-500">Undone by {c.undoneByName}</span>
                ) : c.notUndoableReason ? (
                  <span className="max-w-xs text-right text-xs text-slate-500">Can&apos;t be undone: {c.notUndoableReason}</span>
                ) : (
                  <TallyUndoButton changeId={c.id} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
