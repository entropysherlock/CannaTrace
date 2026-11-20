import { and, desc, eq, gt } from "drizzle-orm";
import { FileText } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { tallyAttachments } from "@/db/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { facilityZone } from "@/lib/time";
import { InboxDelete } from "@/components/inbox-delete";

export const metadata = { title: "Phone inbox" };

/** Photos and PDFs you sent from your phone, newest first. They wait here a week. */
export default async function InboxPage() {
  const session = await requireSession();
  const zone = await facilityZone(session.facilityId);
  const rows = await db
    .select({ id: tallyAttachments.id, name: tallyAttachments.name, kind: tallyAttachments.kind, size: tallyAttachments.size, createdAt: tallyAttachments.createdAt, expiresAt: tallyAttachments.expiresAt })
    .from(tallyAttachments)
    .where(
      and(
        eq(tallyAttachments.orgId, session.orgId),
        eq(tallyAttachments.facilityId, session.facilityId),
        eq(tallyAttachments.userId, session.userId),
        eq(tallyAttachments.source, "phone"),
        eq(tallyAttachments.status, "READY"),
        gt(tallyAttachments.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(tallyAttachments.createdAt))
    .limit(100);
  const time = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: zone });
  return (
    <>
      <PageHeader title="Phone inbox" subtitle="Photos and PDFs you sent from your phone to this store. They are kept for a week." />
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600" data-testid="inbox-empty">
            Nothing here yet. Link your phone under Your account, open CannaTrace on it, and tap Take a photo.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="inbox">
          {rows.map((r) => (
            <li key={r.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {r.kind === "IMAGE" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/assistant/attachments/${r.id}`} alt={r.name} className="h-48 w-full bg-slate-100 object-cover" />
              ) : (
                <div className="flex h-48 items-center justify-center bg-slate-100 text-slate-500">
                  <FileText className="h-12 w-12" aria-hidden="true" />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.name}</span>
                  <span className="block text-xs text-slate-500">Sent {time(r.createdAt)}</span>
                </span>
                <InboxDelete id={r.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
