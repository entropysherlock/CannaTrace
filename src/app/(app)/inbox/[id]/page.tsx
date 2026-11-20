import { and, eq, gt } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoaReview } from "@/components/coa-review";
import { ScanAutoRead } from "@/components/scan-auto-read";
import { PageHeader } from "@/components/ui";
import { CheckCircle2 } from "lucide-react";
import { labResults, packages, tallyAttachments } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getScan, matchPackages } from "@/lib/scan/read";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Review a document" };

/** One photo or scan: Tally reads it, a person checks it, one tap saves it. */
export default async function ReviewDocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ package?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { package: wanted } = await searchParams;
  const [file] = await db
    .select({ id: tallyAttachments.id, name: tallyAttachments.name, kind: tallyAttachments.kind })
    .from(tallyAttachments)
    .where(and(eq(tallyAttachments.id, id), eq(tallyAttachments.orgId, session.orgId), eq(tallyAttachments.facilityId, session.facilityId), eq(tallyAttachments.userId, session.userId), eq(tallyAttachments.status, "READY"), gt(tallyAttachments.expiresAt, new Date())));
  if (!file || (file.kind !== "IMAGE" && file.kind !== "PDF")) notFound();
  const allowed = can(session, "inventory.write");
  const scan = allowed ? await getScan(session, id) : null;
  let saved: { packageId: string; tag: string; quarantined: boolean } | null = null;
  if (scan?.status === "APPLIED" && scan.resultRef) {
    const [r] = await db
      .select({ packageId: packages.id, tag: packages.tag, status: packages.status })
      .from(labResults)
      .innerJoin(packages, eq(packages.id, labResults.packageId))
      .where(and(eq(labResults.id, scan.resultRef), eq(labResults.orgId, session.orgId)));
    if (r) saved = { packageId: r.packageId, tag: r.tag, quarantined: r.status === "QUARANTINE" };
  }
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
        <div className="mx-auto max-w-xl rounded-2xl border border-brand-200 bg-white p-8 text-center shadow-sm" data-testid="scan-done">
          <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" aria-hidden="true" />
          <h2 className="mt-3 font-display text-2xl font-bold">{saved ? `Saved to ${saved.tag}` : "Already saved"}</h2>
          <p className="mt-1 text-slate-600" data-testid="already-saved">This certificate was already saved to a package.</p>
          {saved?.quarantined ? <p role="status" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">A failed result puts the package in quarantine automatically. It can&apos;t be sold or moved until it is released.</p> : null}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {saved ? <Link href={`/inventory/${saved.packageId}`} className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">Open the package</Link> : null}
            <Link href="/inbox" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Back to the inbox</Link>
          </div>
        </div>
      ) : scan.proposal.kind === "OTHER" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6" data-testid="not-supported">
          <h2 className="font-display text-lg font-bold">This isn&apos;t a lab certificate</h2>
          <p className="mt-1 text-sm text-slate-600">{scan.proposal.summary} Tally can fill in lab certificates today. Delivery manifests and harvest sheets are coming next.</p>
        </div>
      ) : (
        <CoaReview attachmentId={id} name={file.name} isPdf={file.kind === "PDF"} proposal={scan.proposal} matches={await matchPackages(session, scan.proposal.identifiers, "", typeof wanted === "string" ? wanted : undefined)} />
      )}
    </>
  );
}
