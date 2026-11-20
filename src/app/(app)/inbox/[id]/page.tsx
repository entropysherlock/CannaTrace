import { and, eq, gt } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoaReview } from "@/components/coa-review";
import { ScanAutoRead } from "@/components/scan-auto-read";
import { PageHeader } from "@/components/ui";
import { tallyAttachments } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getScan, matchPackages } from "@/lib/scan/read";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Review a document" };

/** One photo or scan: Tally reads it, a person checks it, one tap saves it. */
export default async function ReviewDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const [file] = await db
    .select({ id: tallyAttachments.id, name: tallyAttachments.name, kind: tallyAttachments.kind })
    .from(tallyAttachments)
    .where(and(eq(tallyAttachments.id, id), eq(tallyAttachments.orgId, session.orgId), eq(tallyAttachments.facilityId, session.facilityId), eq(tallyAttachments.userId, session.userId), eq(tallyAttachments.status, "READY"), gt(tallyAttachments.expiresAt, new Date())));
  if (!file || (file.kind !== "IMAGE" && file.kind !== "PDF")) notFound();
  const allowed = can(session, "inventory.write");
  const scan = allowed ? await getScan(session, id) : null;
  const back = (
    <Link href="/inbox" className="text-sm font-semibold text-brand-800 underline">
      Back to the inbox
    </Link>
  );
  return (
    <>
      <PageHeader title="Review a document" subtitle="Tally read it. Check what it found, then confirm." action={back} />
      {!allowed ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">Your role can&apos;t record lab results, so documents can&apos;t be filled in for you. Ask someone who manages inventory to open this one.</p>
      ) : !scan ? (
        <ScanAutoRead attachmentId={id} />
      ) : scan.status === "APPLIED" ? (
        <p className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-sm font-semibold text-brand-900" data-testid="already-saved">This certificate was already saved to a package.</p>
      ) : scan.proposal.kind === "OTHER" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6" data-testid="not-supported">
          <h2 className="font-display text-lg font-bold">This isn&apos;t a lab certificate</h2>
          <p className="mt-1 text-sm text-slate-600">{scan.proposal.summary} Tally can fill in lab certificates today. Delivery manifests and harvest sheets are coming next.</p>
        </div>
      ) : (
        <CoaReview attachmentId={id} name={file.name} isPdf={file.kind === "PDF"} proposal={scan.proposal} matches={await matchPackages(session, scan.proposal.identifiers)} />
      )}
    </>
  );
}
