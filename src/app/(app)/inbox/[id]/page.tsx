import { and, eq, gt } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoaReview } from "@/components/coa-review";
import { DocReview } from "@/components/doc-review";
import { ManifestReview } from "@/components/manifest-review";
import { HarvestApply, InvoiceApply, LicenseApply, OrderApply, PriceListApply } from "@/components/doc-apply";
import { appliedSummary, harvestContext, invoiceContext, licenseContext, orderContext, priceListContext } from "@/lib/scan/apply";
import { manifestContext } from "@/lib/scan/manifest";
import { ScanAutoRead } from "@/components/scan-auto-read";
import { PageHeader } from "@/components/ui";
import { CheckCircle2 } from "lucide-react";
import { labResults, packages, tallyAttachments } from "@/db/schema";
import { db } from "@/lib/db";
import { canReadDocuments } from "@/lib/scan/can-read";
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
  const allowed = canReadDocuments(session);
  const scan = allowed ? await getScan(session, id) : null;
  let saved: { packageId: string; tag: string; quarantined: boolean } | null = null;
  const receivedCount = scan?.status === "APPLIED" && scan.resultRef?.startsWith("RECEIVED:") ? Number(scan.resultRef.slice(9)) : null;
  const otherRef = scan?.status === "APPLIED" && scan.resultRef && /^(COSTED|HARVEST|LICENSE|PRICES|ORDER):/.test(scan.resultRef) ? scan.resultRef : null;
  if (scan?.status === "APPLIED" && scan.resultRef && receivedCount === null && !otherRef) {
    const [r] = await db
      .select({ packageId: packages.id, tag: packages.tag, status: packages.status })
      .from(labResults)
      .innerJoin(packages, eq(packages.id, labResults.packageId))
      .where(and(eq(labResults.id, scan.resultRef), eq(labResults.orgId, session.orgId)));
    if (r) saved = { packageId: r.packageId, tag: r.tag, quarantined: r.status === "QUARANTINE" };
  }
  const otherInfo = otherRef ? await appliedSummary(session, otherRef) : null;
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
          <h2 className="mt-3 font-display text-2xl font-bold">{otherInfo ? otherInfo.title : otherRef ? "Already saved" : receivedCount !== null ? `Received ${receivedCount} package${receivedCount === 1 ? "" : "s"}` : saved ? `Saved to ${saved.tag}` : "Already saved"}</h2>
          <p className="mt-1 text-slate-600" data-testid="already-saved">{otherInfo ? otherInfo.body : otherRef ? "This document was already saved, so nothing more will change." : receivedCount !== null ? "This manifest was already received into your inventory." : "This certificate was already saved to a package."}</p>
          {saved?.quarantined ? <p role="status" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">A failed result puts the package in quarantine automatically. It can&apos;t be sold or moved until it is released.</p> : null}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {otherInfo?.href ? <Link href={otherInfo.href} className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">{otherInfo.hrefLabel}</Link> : null}
            {receivedCount !== null ? <Link href="/inventory" className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">See the packages</Link> : null}
            {saved ? <Link href={`/inventory/${saved.packageId}`} className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">Open the package</Link> : null}
            <Link href="/inbox" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Back to the inbox</Link>
          </div>
        </div>
      ) : scan.proposal.kind === "OTHER" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6" data-testid="not-supported">
          <h2 className="font-display text-lg font-bold">This isn&apos;t a lab certificate</h2>
          <p className="mt-1 text-sm text-slate-600">{scan.proposal.summary} Tally recognises lab certificates, manifests, invoices, harvest sheets, licenses and more.</p>
        </div>
      ) : scan.proposal.kind === "DOC" && scan.proposal.docType === "MANIFEST" && scan.proposal.items.length > 0 ? (
        <ManifestReview attachmentId={id} name={file.name} isPdf={file.kind === "PDF"} proposal={scan.proposal} ctx={await manifestContext(session, scan.proposal)} />
      ) : scan.proposal.kind === "DOC" && scan.proposal.docType === "INVOICE" && scan.proposal.items.length > 0 ? (
        <InvoiceApply base={{ attachmentId: id, name: file.name, isPdf: file.kind === "PDF", proposal: scan.proposal }} ctx={await invoiceContext(session, scan.proposal)} />
      ) : scan.proposal.kind === "DOC" && scan.proposal.docType === "HARVEST_SHEET" && scan.proposal.items.length > 0 ? (
        <HarvestApply base={{ attachmentId: id, name: file.name, isPdf: file.kind === "PDF", proposal: scan.proposal }} ctx={await harvestContext(session, scan.proposal)} />
      ) : scan.proposal.kind === "DOC" && scan.proposal.docType === "LICENSE" ? (
        <LicenseApply base={{ attachmentId: id, name: file.name, isPdf: file.kind === "PDF", proposal: scan.proposal }} ctx={await licenseContext(session, scan.proposal)} />
      ) : scan.proposal.kind === "DOC" && scan.proposal.docType === "PRICE_LIST" && scan.proposal.items.length > 0 ? (
        <PriceListApply base={{ attachmentId: id, name: file.name, isPdf: file.kind === "PDF", proposal: scan.proposal }} ctx={await priceListContext(session, scan.proposal)} />
      ) : scan.proposal.kind === "DOC" && scan.proposal.docType === "WHOLESALE_ORDER" && scan.proposal.items.length > 0 ? (
        <OrderApply base={{ attachmentId: id, name: file.name, isPdf: file.kind === "PDF", proposal: scan.proposal }} ctx={await orderContext(session, scan.proposal)} />
      ) : scan.proposal.kind === "DOC" ? (
        <DocReview attachmentId={id} name={file.name} isPdf={file.kind === "PDF"} proposal={scan.proposal} />
      ) : (
        <CoaReview attachmentId={id} name={file.name} isPdf={file.kind === "PDF"} proposal={scan.proposal} matches={await matchPackages(session, scan.proposal.identifiers, "", typeof wanted === "string" ? wanted : undefined)} />
      )}
    </>
  );
}
