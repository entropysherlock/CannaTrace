import Link from "next/link";
import { TallyUndoButton } from "@/components/tally-undo-button";
import { PageHeader, ScrollBox } from "@/components/ui";
import { recentChanges } from "@/lib/assistant/changes";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { actionLabel, changedFields, entityLabel, recordHref, recordName } from "@/lib/audit-format";

const PAGE_SIZE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; who?: string; type?: string; q?: string }> }) {
  const session = await requirePagePermission("audit.view");
  const zone = await facilityZone(session.facilityId);
  const params = await searchParams;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const who = (params.who ?? "").trim();
  const type = (params.type ?? "").trim();
  const q = (params.q ?? "").trim().slice(0, 80);
  const scope = and(eq(auditLogs.orgId, session.orgId), or(eq(auditLogs.facilityId, session.facilityId), isNull(auditLogs.facilityId)));
  // Search the record's tag, number, or name in its snapshot, or the reason given.
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = and(
    scope,
    who ? eq(auditLogs.userName, who) : undefined,
    type ? eq(auditLogs.entityType, type) : undefined,
    q ? or(ilike(sql`${auditLogs.after}::text`, like), ilike(sql`${auditLogs.before}::text`, like), ilike(auditLogs.reason, like), eq(auditLogs.entityId, q)) : undefined,
  );
  const [entries, [{ total }], people, types] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    db.selectDistinct({ name: auditLogs.userName }).from(auditLogs).where(scope).orderBy(auditLogs.userName),
    db.selectDistinct({ type: auditLogs.entityType }).from(auditLogs).where(scope).orderBy(auditLogs.entityType),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const sp = new URLSearchParams();
    if (who) sp.set("who", who);
    if (type) sp.set("type", type);
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/audit?${s}` : "/audit";
  };
  const tally = await recentChanges(session, 15);

  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every change at this facility, who made it, and when. Entries cannot be edited or deleted. Filter or search to find a record's history." />
      {tally.length ? (
        <section className="mb-6" aria-labelledby="tally-changes">
          <h2 id="tally-changes" className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Changes made through Tally
          </h2>
          <ScrollBox label="Changes made through Tally" className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100 text-sm">
              {tally.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-900">{c.title}</span>
                    <span className="block text-slate-600">{c.result}</span>
                    <span className="block text-xs text-slate-500">
                      {c.userName} ·{" "}
                      {c.createdAt.toLocaleString("en-US", {
                        timeZone: zone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
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
          </ScrollBox>
        </section>
      ) : null}
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2 text-sm" role="search" aria-label="Filter the audit trail">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Tag, number, name or reason</span>
          <input name="q" defaultValue={q} placeholder="for example CT-000101" className="min-h-10 w-56 rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Person</span>
          <select name="who" defaultValue={who} className="min-h-10 rounded-lg border border-slate-300 px-2">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Kind of record</span>
          <select name="type" defaultValue={type} className="min-h-10 rounded-lg border border-slate-300 px-2">
            <option value="">All</option>
            {types.map((t) => (
              <option key={t.type} value={t.type}>
                {entityLabel(t.type)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-lg bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
          Show
        </button>
        {q || who || type ? (
          <Link href="/audit" className="min-h-10 px-2 py-2 font-medium text-brand-700 hover:underline">
            Clear
          </Link>
        ) : null}
        <span className="ml-auto text-slate-600" data-testid="audit-count">
          {total.toLocaleString("en-US")} {total === 1 ? "entry" : "entries"}
          {pages > 1 ? ` · page ${page} of ${pages}` : ""}
        </span>
      </form>
      <ScrollBox label="Audit trail entries" size="lg" className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {entries.length === 0 ? <p className="px-4 py-6 text-sm text-slate-600">No entries match.</p> : null}
        <ul className="divide-y divide-slate-100 text-sm">
          {entries.map((entry) => {
            const name = recordName(entry.before, entry.after);
            const href = recordHref(entry.entityType, entry.entityId);
            const changes = changedFields(entry.before, entry.after);
            return (
              <li key={entry.id} className="px-4 py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-semibold text-slate-900">{entry.userName}</span> <span className="text-slate-600">{actionLabel(entry.action)}</span>{" "}
                    <span className="text-slate-600">{entityLabel(entry.entityType)}</span>{" "}
                    {name ? (
                      href ? (
                        <Link href={href} className="font-medium text-brand-700 hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-900">{name}</span>
                      )
                    ) : href ? (
                      <Link href={href} className="font-medium text-brand-700 hover:underline">
                        open
                      </Link>
                    ) : null}
                  </span>
                  <time className="text-slate-500">{entry.createdAt.toLocaleString("en-US", { timeZone: zone, dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
                {entry.reason ? <p className="text-slate-600">{entry.reason}</p> : null}
                {changes.length ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">What changed</summary>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-600">
                      {changes.map((c) => (
                        <div key={c.field} className="contents">
                          <dt className="font-medium">{c.field}</dt>
                          <dd className="break-all">
                            {c.from} → {c.to}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </ScrollBox>
      {pages > 1 ? (
        <nav className="mt-3 flex items-center justify-between text-sm" aria-label="Audit trail pages">
          {page > 1 ? (
            <Link href={link(page - 1)} className="font-semibold text-brand-700 hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link href={link(page + 1)} className="font-semibold text-brand-700 hover:underline">
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
